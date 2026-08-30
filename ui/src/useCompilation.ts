import { useEffect, useRef, useState } from "react";
import { createAppRef, App, updateAppRef } from "./apps";
import { loadApp } from "./appLoader";
import { CompileStatus as ApiCompileStatus, GetConfigurationResponse, LogLevel, OpenStatus } from "./server/api";
import { getApiClient } from "./server/connection";

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function elapsed(app: App): string {
  return formatDuration(Date.now() - (app.compilation.startTime || 0));
}

export function useCompilation(
  apps: App[],
  onUpdate: (apps: App[] | ((prev: App[]) => App[])) => void,
  onConfigurationLoaded: (response: GetConfigurationResponse) => void,
): { configurationLoaded: boolean } {
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const client = getApiClient();
  const abortControllers = useRef<{ [key: string]: AbortController }>({});
  const appsRef = useRef(apps);

  appsRef.current = apps;

  // An update names the app it is about, and finds it when it is applied: apps
  // compile at their own pace, so an index read before the call is one the list may
  // have moved by the time the answer comes back.
  const updateApp = (appName: string, update: (app: App) => App) => {
    onUpdate((prevApps) => {
      const index = prevApps.findIndex((p) => p.configuration.name === appName);
      if (index === -1) return prevApps;

      const updatedApps = [...prevApps];
      updatedApps[index] = update(prevApps[index]);
      return updatedApps;
    });
  };

  const compile = async (appName: string) => {
    const app = appsRef.current.find((p) => p.configuration.name === appName);

    if (!app) return;

    if (app.compilation.status === "running") {
      return;
    }

    abortControllers.current[appName]?.abort();
    abortControllers.current[appName] = new AbortController();
    const signal = abortControllers.current[appName].signal;

    try {
      updateApp(appName, (app) => ({
        ...app,
        compilation: {
          ...app.compilation,
          status: "running",
          startTime: Date.now(),
        },
      }));

      // Opening an app yields the proto surface to compile. Where the app is invoked
      // is not part of the answer: the server holds it under the app's own name.
      const { response: openResponse } = await client.openApp({
        app: app.configuration,
      });

      updateApp(appName, (app) => {
        updateAppRef(app.appRef, app.configuration);
        return {
          ...app,
          compilation: {
            ...app.compilation,
            logs: openResponse.logs,
          },
        };
      });

      if (signal.aborted) return;

      if (openResponse.status === OpenStatus.ERROR) {
        updateApp(appName, (app) => ({
          ...app,
          compilation: { status: "error", logs: app.compilation.logs, duration: elapsed(app) },
        }));
        return;
      }

      await streamCompilation(appName, openResponse.protoDir, signal);
    } catch (error: any) {
      if (signal.aborted) return;

      console.error("Compilation error:", error);
      // A call that never answered has nothing to report but itself, and an app left
      // at "running" would spin for the rest of the session.
      updateApp(appName, (app) => ({
        ...app,
        compilation: {
          status: "error",
          logs: [...app.compilation.logs, { level: LogLevel.LEVEL_ERROR, message: `Compilation failed: ${error?.message ?? error}` }],
          duration: elapsed(app),
        },
      }));
    } finally {
      if (abortControllers.current[appName]?.signal === signal) {
        delete abortControllers.current[appName];
      }
    }
  };

  // The compilation is a stream: every log line arrives as it is written and the last
  // message is the verdict, carrying the generated sources on a success.
  const streamCompilation = async (appName: string, protoDir: string, signal: AbortSignal) => {
    const call = client.compile({ protoDir }, { abort: signal });

    for await (const response of call.responses) {
      if (signal.aborted) return;

      if (response.status === ApiCompileStatus.STATUS_RUNNING) {
        updateApp(appName, (app) => ({
          ...app,
          compilation: {
            ...app.compilation,
            status: "running",
            logs: [...app.compilation.logs, ...response.logs],
          },
        }));
        continue;
      }

      const finalApp = appsRef.current.find((p) => p.configuration.name === appName);
      if (!finalApp) return;

      const loadedApp = response.status === ApiCompileStatus.STATUS_READY ? await loadApp(response.sources, response.stub, finalApp.configuration) : undefined;

      updateApp(appName, (app) => ({
        ...(loadedApp ?? app),
        compilation: {
          status: loadedApp ? "success" : "error",
          logs: [...app.compilation.logs, ...response.logs],
          duration: elapsed(app),
        },
      }));
      return;
    }
  };

  // Initialize apps on mount
  useEffect(() => {
    const initializeApps = async () => {
      if (apps.length === 0 && !configurationLoaded) {
        const { response } = await client.getConfiguration({});
        const configApps = response.configuration?.apps || [];

        if (response.configuration) {
          onConfigurationLoaded(response);
        }

        setConfigurationLoaded(true);

        if (configApps.length === 0) return;

        const initialApps: App[] = configApps.map((app) => ({
          configuration: app,
          appRef: createAppRef(app),
          compilation: { status: "pending" as const, logs: response.logs || [] },
          services: [],
          clients: {},
          sources: [],
          stub: { serviceInfos: {} },
        }));

        onUpdate(initialApps);
      }
    };

    initializeApps();
  }, []);

  // Auto-compile pending apps
  useEffect(() => {
    if (apps.length > 0) {
      apps.forEach((app) => {
        if (app.compilation.status === "pending") {
          compile(app.configuration.name);
        }
      });
    }
  }, [apps.map((p) => `${p.configuration.name}:${p.compilation.status}`).join(",")]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(abortControllers.current).forEach((controller) => {
        controller.abort();
      });
      abortControllers.current = {};
    };
  }, []);

  return { configurationLoaded };
}
