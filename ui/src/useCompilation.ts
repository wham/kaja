import { useEffect, useRef, useState } from "react";
import { createProjectRef, Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus as ApiCompileStatus, Configuration, ReflectStatus } from "./server/api";
import { getApiClient } from "./server/connection";

const POLL_INTERVAL_MS = 1000;

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function useCompilation(
  projects: Project[],
  onUpdate: (projects: Project[] | ((prev: Project[]) => Project[])) => void,
  onConfigurationLoaded: (configuration: Configuration) => void,
): { configurationLoaded: boolean } {
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const client = getApiClient();
  const abortControllers = useRef<{ [key: string]: AbortController }>({});
  const projectsRef = useRef(projects);

  projectsRef.current = projects;

  const compile = async (projectName: string) => {
    const currentProjects = projectsRef.current;
    const projectIndex = currentProjects.findIndex((p) => p.configuration.name === projectName);
    const project = currentProjects[projectIndex];

    if (!project || projectIndex === -1) return;

    if (project.compilation.status === "running") {
      return;
    }

    if (abortControllers.current[projectName]) {
      abortControllers.current[projectName].abort();
    }
    abortControllers.current[projectName] = new AbortController();
    const signal = abortControllers.current[projectName].signal;

    try {
      const compilationId = crypto.randomUUID();
      let protoDir = project.configuration.protoDir;

      onUpdate((prevProjects) => {
        const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
        if (index === -1) return prevProjects;

        const updatedProjects = [...prevProjects];
        updatedProjects[index] = {
          ...prevProjects[index],
          compilation: {
            ...prevProjects[index].compilation,
            id: compilationId,
            status: "running",
            startTime: Date.now(),
            logOffset: 0,
          },
        };
        return updatedProjects;
      });

      if (project.configuration.useReflection) {
        const { response: reflectResponse } = await client.reflect({
          url: project.configuration.url,
        });

        onUpdate((prevProjects) => {
          const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
          if (index === -1) return prevProjects;

          const updatedProjects = [...prevProjects];
          updatedProjects[index] = {
            ...prevProjects[index],
            compilation: {
              ...prevProjects[index].compilation,
              logs: reflectResponse.logs,
            },
          };
          return updatedProjects;
        });

        if (reflectResponse.status === ReflectStatus.ERROR) {
          const finalProject = projectsRef.current.find((p) => p.configuration.name === projectName);
          const duration = formatDuration(Date.now() - (finalProject?.compilation.startTime || 0));

          onUpdate((prevProjects) => {
            const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
            if (index === -1) return prevProjects;

            const updatedProjects = [...prevProjects];
            updatedProjects[index] = {
              ...prevProjects[index],
              compilation: {
                status: "error",
                logs: reflectResponse.logs,
                duration,
              },
            };
            return updatedProjects;
          });

          delete abortControllers.current[projectName];
          return;
        }

        protoDir = reflectResponse.protoDir;
      }

      if (signal.aborted) return;

      await pollCompilation(projectName, compilationId, protoDir, signal);
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Compilation error:", error);
      }
    }
  };

  const pollCompilation = async (projectName: string, compilationId: string, protoDir: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      const projectIndex = projectsRef.current.findIndex((p) => p.configuration.name === projectName);
      const project = projectsRef.current[projectIndex];
      if (!project || projectIndex === -1) return;

      const { response } = await client.compile({
        id: compilationId,
        logOffset: project.compilation.logOffset || 0,
        protoDir,
      });

      if (signal.aborted) return;

      const isRunning = response.status === ApiCompileStatus.STATUS_RUNNING;
      const isReady = response.status === ApiCompileStatus.STATUS_READY;

      if (isRunning) {
        onUpdate((prevProjects) => {
          const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
          if (index === -1) return prevProjects;

          const currentProject = prevProjects[index];
          const newLogs = [...(currentProject.compilation.logs || []), ...response.logs];
          const newLogOffset = (currentProject.compilation.logOffset || 0) + response.logs.length;

          const updatedProjects = [...prevProjects];
          updatedProjects[index] = {
            ...currentProject,
            compilation: {
              ...currentProject.compilation,
              status: "running",
              logs: newLogs,
              logOffset: newLogOffset,
            },
          };
          return updatedProjects;
        });

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        const finalProject = projectsRef.current.find((p) => p.configuration.name === projectName);
        if (!finalProject) return;

        const duration = formatDuration(Date.now() - (finalProject.compilation.startTime || 0));

        if (isReady) {
          const loadedProject = await loadProject(response.sources, response.stub, finalProject.configuration);

          onUpdate((prevProjects) => {
            const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
            if (index === -1) return prevProjects;

            const currentProject = prevProjects[index];
            const newLogs = [...(currentProject.compilation.logs || []), ...response.logs];

            const updatedProjects = [...prevProjects];
            updatedProjects[index] = {
              ...loadedProject,
              compilation: {
                status: "success",
                logs: newLogs,
                duration,
              },
            };
            return updatedProjects;
          });
        } else {
          onUpdate((prevProjects) => {
            const index = prevProjects.findIndex((p) => p.configuration.name === projectName);
            if (index === -1) return prevProjects;

            const currentProject = prevProjects[index];
            const newLogs = [...(currentProject.compilation.logs || []), ...response.logs];

            const updatedProjects = [...prevProjects];
            updatedProjects[index] = {
              ...currentProject,
              compilation: {
                status: "error",
                logs: newLogs,
                duration,
              },
            };
            return updatedProjects;
          });
        }

        delete abortControllers.current[projectName];
        return;
      }
    }
  };

  // Initialize projects on mount
  useEffect(() => {
    const initializeProjects = async () => {
      if (projects.length === 0 && !configurationLoaded) {
        const { response } = await client.getConfiguration({});
        const configProjects = response.configuration?.projects || [];

        if (response.configuration) {
          onConfigurationLoaded(response.configuration);
        }

        setConfigurationLoaded(true);

        if (configProjects.length === 0) return;

        const initialProjects: Project[] = configProjects.map((configProject) => ({
          configuration: configProject,
          projectRef: createProjectRef(configProject),
          compilation: {
            status: "pending" as const,
            logs: response.logs || [],
          },
          services: [],
          clients: {},
          sources: [],
          stub: { serviceInfos: {} },
        }));

        onUpdate(initialProjects);
      }
    };

    initializeProjects();
  }, []);

  // Auto-compile pending projects
  useEffect(() => {
    if (projects.length > 0) {
      projects.forEach((project) => {
        if (project.compilation.status === "pending") {
          compile(project.configuration.name);
        }
      });
    }
  }, [projects.map((p) => `${p.configuration.name}:${p.compilation.status}`).join(",")]);

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
