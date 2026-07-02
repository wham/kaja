import { useEffect, useRef, useState } from "react";
import { createAppRef, App, Transport, transportFromProtocol, updateAppRef } from "./apps";
import { loadApp } from "./appLoader";
import { CompileStatus as ApiCompileStatus, Configuration, Log, OpenStatus } from "./server/api";
import { getApiClient } from "./server/connection";

const POLL_INTERVAL_MS = 1000;

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function useCompilation(
  apps: App[],
  onUpdate: (apps: App[] | ((prev: App[]) => App[])) => void,
  onConfigurationLoaded: (configuration: Configuration) => void,
): { configurationLoaded: boolean; configurationLogs: Log[] } {
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [configurationLogs, setConfigurationLogs] = useState<Log[]>([]);
  const client = getApiClient();
  const abortControllers = useRef<{ [key: string]: AbortController }>({});
  const appsRef = useRef(apps);

  appsRef.current = apps;

  const compile = async (appName: string) => {
    const currentApps = appsRef.current;
    const appIndex = currentApps.findIndex((p) => p.configuration.name === appName);
    const app = currentApps[appIndex];

    if (!app || appIndex === -1) return;

    if (app.compilation.status === "running") {
      return;
    }

    if (abortControllers.current[appName]) {
      abortControllers.current[appName].abort();
    }
    abortControllers.current[appName] = new AbortController();
    const signal = abortControllers.current[appName].signal;

    try {
      const compilationId = crypto.randomUUID();

      onUpdate((prevApps) => {
        const index = prevApps.findIndex((p) => p.configuration.name === appName);
        if (index === -1) return prevApps;

        const updatedApps = [...prevApps];
        updatedApps[index] = {
          ...prevApps[index],
          compilation: {
            ...prevApps[index].compilation,
            id: compilationId,
            status: "running",
            startTime: Date.now(),
            logOffset: 0,
          },
        };
        return updatedApps;
      });

      // Opening an app yields the proto surface to compile, the invocation
      // target, and the transport the client uses to reach it.
      const { response: openResponse } = await client.openApp({
        app: app.configuration,
      });

      const target = openResponse.target;
      const protocol = transportFromProtocol(openResponse.protocol);

      onUpdate((prevApps) => {
        const index = prevApps.findIndex((p) => p.configuration.name === appName);
        if (index === -1) return prevApps;

        const updatedApps = [...prevApps];
        updateAppRef(prevApps[index].appRef, prevApps[index].configuration, target, protocol);
        updatedApps[index] = {
          ...prevApps[index],
          target,
          protocol,
          compilation: {
            ...prevApps[index].compilation,
            logs: openResponse.logs,
          },
        };
        return updatedApps;
      });

      if (openResponse.status === OpenStatus.ERROR) {
        const finalApp = appsRef.current.find((p) => p.configuration.name === appName);
        const duration = formatDuration(Date.now() - (finalApp?.compilation.startTime || 0));

        onUpdate((prevApps) => {
          const index = prevApps.findIndex((p) => p.configuration.name === appName);
          if (index === -1) return prevApps;

          const updatedApps = [...prevApps];
          updatedApps[index] = {
            ...prevApps[index],
            compilation: { status: "error", logs: openResponse.logs, duration },
          };
          return updatedApps;
        });

        delete abortControllers.current[appName];
        return;
      }

      if (signal.aborted) return;

      await pollCompilation(appName, compilationId, openResponse.protoDir, target, protocol, signal);
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Compilation error:", error);
      }
    }
  };

  const pollCompilation = async (appName: string, compilationId: string, protoDir: string, target: string, protocol: Transport, signal: AbortSignal) => {
    while (!signal.aborted) {
      const appIndex = appsRef.current.findIndex((p) => p.configuration.name === appName);
      const app = appsRef.current[appIndex];
      if (!app || appIndex === -1) return;

      const { response } = await client.compile({
        id: compilationId,
        logOffset: app.compilation.logOffset || 0,
        protoDir,
      });

      if (signal.aborted) return;

      const isRunning = response.status === ApiCompileStatus.STATUS_RUNNING;
      const isReady = response.status === ApiCompileStatus.STATUS_READY;

      if (isRunning) {
        onUpdate((prevApps) => {
          const index = prevApps.findIndex((p) => p.configuration.name === appName);
          if (index === -1) return prevApps;

          const currentApp = prevApps[index];
          const newLogs = [...(currentApp.compilation.logs || []), ...response.logs];
          const newLogOffset = (currentApp.compilation.logOffset || 0) + response.logs.length;

          const updatedApps = [...prevApps];
          updatedApps[index] = {
            ...currentApp,
            compilation: {
              ...currentApp.compilation,
              status: "running",
              logs: newLogs,
              logOffset: newLogOffset,
            },
          };
          return updatedApps;
        });

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        const finalApp = appsRef.current.find((p) => p.configuration.name === appName);
        if (!finalApp) return;

        const duration = formatDuration(Date.now() - (finalApp.compilation.startTime || 0));

        if (isReady) {
          const loadedApp = await loadApp(response.sources, response.stub, finalApp.configuration, target, protocol);

          onUpdate((prevApps) => {
            const index = prevApps.findIndex((p) => p.configuration.name === appName);
            if (index === -1) return prevApps;

            const currentApp = prevApps[index];
            const newLogs = [...(currentApp.compilation.logs || []), ...response.logs];

            const updatedApps = [...prevApps];
            updatedApps[index] = {
              ...loadedApp,
              compilation: {
                status: "success",
                logs: newLogs,
                duration,
              },
            };
            return updatedApps;
          });
        } else {
          onUpdate((prevApps) => {
            const index = prevApps.findIndex((p) => p.configuration.name === appName);
            if (index === -1) return prevApps;

            const currentApp = prevApps[index];
            const newLogs = [...(currentApp.compilation.logs || []), ...response.logs];

            const updatedApps = [...prevApps];
            updatedApps[index] = {
              ...currentApp,
              compilation: {
                status: "error",
                logs: newLogs,
                duration,
              },
            };
            return updatedApps;
          });
        }

        delete abortControllers.current[appName];
        return;
      }
    }
  };

  // Initialize apps on mount
  useEffect(() => {
    const initializeApps = async () => {
      if (apps.length === 0 && !configurationLoaded) {
        const { response } = await client.getConfiguration({});
        const configApps = response.configuration?.apps || [];

        if (response.configuration) {
          onConfigurationLoaded(response.configuration);
        }

        setConfigurationLogs(response.logs || []);
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
          target: "",
          protocol: Transport.GRPC,
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

  return { configurationLoaded, configurationLogs };
}
