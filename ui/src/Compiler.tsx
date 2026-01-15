import { CheckIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import { ActionList, Spinner } from "@primer/react";
import { FirstProjectBlankslate } from "./FirstProjectBlankslate";
import { useEffect, useRef, useState } from "react";
import { LayoutColumn, LayoutScroll } from "./Layout";
import { CompilationStatus, Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus as ApiCompileStatus, Configuration, RpcProtocol } from "./server/api";
import { getApiClient } from "./server/connection";

interface CompilerProps {
  projects: Project[];
  canUpdateConfiguration: boolean;
  onUpdate: (projects: Project[] | ((prev: Project[]) => Project[])) => void;
  onConfigurationLoaded?: (configuration: Configuration) => void;
  onNewProjectClick?: () => void;
}

// Constants
const POLL_INTERVAL_MS = 1000;
const ICON_SIZE = 20;
const CHEVRON_SIZE = 16;
const CHECK_ICON_SIZE = 12;
const LOG_LINE_HEIGHT = 20;
const LOG_FONT_SIZE = 12;
const LOG_PADDING = "12px 16px";
const LINE_NUMBER_WIDTH = "40px";
const LINE_NUMBER_MARGIN = 16;

export function Compiler({ projects, canUpdateConfiguration, onUpdate, onConfigurationLoaded, onNewProjectClick }: CompilerProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const client = getApiClient();
  const abortControllers = useRef<{ [key: string]: AbortController }>({});
  const projectsRef = useRef(projects);

  // Keep projectsRef updated
  projectsRef.current = projects;

  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  };

  const compile = async (projectName: string) => {
    // Get current project state from ref
    const currentProjects = projectsRef.current;
    const projectIndex = currentProjects.findIndex((p) => p.configuration.name === projectName);
    const project = currentProjects[projectIndex];

    if (!project || projectIndex === -1) return;

    // Prevent concurrent compilations - check if already running
    if (project.compilation.status === "running") {
      return;
    }

    // Create abort controller for this compilation
    if (abortControllers.current[projectName]) {
      abortControllers.current[projectName].abort();
    }
    abortControllers.current[projectName] = new AbortController();
    const signal = abortControllers.current[projectName].signal;

    try {
      // Generate unique ID for this compilation
      const compilationId = crypto.randomUUID();

      // Set initial running state with start time using functional update
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

      // Start polling
      await pollCompilation(projectName, compilationId, signal);
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Compilation error:", error);
      }
    }
  };

  const pollCompilation = async (projectName: string, compilationId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      // Find project by name to avoid stale index references
      const projectIndex = projectsRef.current.findIndex((p) => p.configuration.name === projectName);
      const project = projectsRef.current[projectIndex];
      if (!project || projectIndex === -1) return;

      const { response } = await client.compile({
        id: compilationId,
        logOffset: project.compilation.logOffset || 0,
        protoDir: project.configuration.protoDir,
      });

      if (signal.aborted) return;

      const isRunning = response.status === ApiCompileStatus.STATUS_RUNNING;
      const isReady = response.status === ApiCompileStatus.STATUS_READY;

      if (isRunning) {
        // Update state using functional update to avoid race conditions
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

        // Continue polling
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        // Compilation complete - need to get fresh project state for duration calculation
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

  useEffect(() => {
    // Initialize projects if needed
    const initializeProjects = async () => {
      if (projects.length === 0 && !configurationLoaded) {
        // Load initial configuration
        const { response } = await client.getConfiguration({});
        const configProjects = response.configuration?.projects || [];

        if (response.configuration && onConfigurationLoaded) {
          onConfigurationLoaded(response.configuration);
        }

        setConfigurationLoaded(true);

        if (configProjects.length === 0) return;

        const initialProjects: Project[] = configProjects.map((configProject) => ({
          configuration: configProject,
          compilation: {
            status: "pending",
            logs: response.logs || [],
          },
          services: [],
          clients: {},
          sources: [],
          stub: {},
        }));

        onUpdate(initialProjects);
      }
    };

    initializeProjects();
  }, []);

  // Start compilation for pending projects
  useEffect(() => {
    if (projects.length > 0) {
      projects.forEach((project) => {
        // Only compile if status is exactly "pending"
        if (project.compilation.status === "pending") {
          compile(project.configuration.name);
        }
      });
    }
  }, [projects.map((p) => `${p.configuration.name}:${p.compilation.status}`).join(",")]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort all ongoing compilations
      Object.values(abortControllers.current).forEach((controller) => {
        controller.abort();
      });
      abortControllers.current = {};
    };
  }, []);

  const toggleExpand = (projectName: string) => {
    setExpandedProjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(projectName)) {
        newSet.delete(projectName);
      } else {
        newSet.add(projectName);
      }
      return newSet;
    });
  };

  const getStatusVariant = (status: CompilationStatus) => {
    return status === "error" ? "danger" : undefined;
  };

  const renderSpinner = () => (
    <div
      className="spinner-rotating"
      style={{
        width: ICON_SIZE,
        height: ICON_SIZE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner size="small" />
    </div>
  );

  const getStatusIcon = (status: CompilationStatus) => {
    if (status === "running") return renderSpinner();
    if (status === "pending") return null;

    const isSuccess = status === "success";
    const bgColor = isSuccess ? "var(--bgColor-success-muted)" : "var(--bgColor-danger-muted)";
    const fgColor = isSuccess ? "var(--fgColor-success)" : "var(--fgColor-danger)";
    const Icon = isSuccess ? CheckIcon : XIcon;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: ICON_SIZE,
          height: ICON_SIZE,
          borderRadius: "50%",
          backgroundColor: bgColor,
        }}
      >
        <Icon size={CHECK_ICON_SIZE} fill={fgColor} />
      </div>
    );
  };

  const getProtocolDisplay = (protocol: RpcProtocol) => {
    return protocol === RpcProtocol.GRPC ? "gRPC" : "Twirp";
  };

  if (projects.length === 0) {
    if (!configurationLoaded) {
      return (
        <LayoutColumn
          style={{
            alignItems: "center",
            justifyContent: "center",
            color: "var(--fgColor-muted)",
            backgroundColor: "var(--bgColor-default)",
          }}
        >
          <div>
            <Spinner size="medium" />
            <div style={{ marginTop: 12 }}>Loading configuration...</div>
          </div>
        </LayoutColumn>
      );
    }

    // Configuration loaded but no projects
    return (
      <FirstProjectBlankslate canUpdateConfiguration={canUpdateConfiguration} onNewProjectClick={onNewProjectClick} />
    );
  }

  return (
    <LayoutColumn style={{ backgroundColor: "var(--bgColor-default)" }}>
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .spinner-rotating {
          animation: spin 1s linear infinite;
        }
        .chevron-icon {
          transition: transform 0.2s;
          color: var(--fgColor-muted);
        }
        .chevron-icon.expanded {
          transform: rotate(90deg);
        }
        .compiler-item-expanded {
          background-color: var(--bgColor-accent-muted) !important;
        }
        .compiler-logs-container {
          background-color: var(--bgColor-canvas-inset);
        }
        .compiler-item-wrapper {
          position: relative;
        }
        .compiler-item-header.sticky {
          position: sticky;
          top: 0;
          z-index: 10;
          background-color: var(--bgColor-default);
        }
      `}</style>
      <LayoutScroll>
        {projects.map((project, index) => {
          const isExpanded = expandedProjects.has(project.configuration.name);
          return (
            <div key={`project-${index}-${project.configuration.name}`} className="compiler-item-wrapper">
              <div className={isExpanded ? "compiler-item-header sticky" : ""}>
                <ActionList>
                  <ActionList.Item
                    variant={getStatusVariant(project.compilation.status)}
                    onSelect={() => toggleExpand(project.configuration.name)}
                    className={isExpanded ? "compiler-item-expanded" : ""}
                  >
                    <ActionList.LeadingVisual>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <ChevronRightIcon size={CHEVRON_SIZE} className={`chevron-icon ${isExpanded ? "expanded" : ""}`} />
                        {getStatusIcon(project.compilation.status)}
                      </div>
                    </ActionList.LeadingVisual>
                    {project.configuration.name}
                    <ActionList.Description>
                      {getProtocolDisplay(project.configuration.protocol)} • {project.configuration.url}
                    </ActionList.Description>
                    {project.compilation.duration && (
                      <ActionList.TrailingVisual>
                        <span style={{ fontSize: 12, color: "var(--fgColor-muted)" }}>{project.compilation.duration}</span>
                      </ActionList.TrailingVisual>
                    )}
                  </ActionList.Item>
                </ActionList>
              </div>
              {isExpanded && (
                <div className="compiler-logs-container">
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: LOG_FONT_SIZE,
                      padding: LOG_PADDING,
                    }}
                  >
                    {project.compilation.logs.map((log, logIndex) => (
                      <div
                        key={logIndex}
                        style={{
                          display: "flex",
                          marginBottom: 1,
                          lineHeight: `${LOG_LINE_HEIGHT}px`,
                        }}
                      >
                        <span
                          style={{
                            color: "var(--fgColor-muted)",
                            minWidth: LINE_NUMBER_WIDTH,
                            textAlign: "right",
                            marginRight: LINE_NUMBER_MARGIN,
                            userSelect: "none",
                          }}
                        >
                          {logIndex + 1}
                        </span>
                        <span style={{ color: getLogColor(log.level), whiteSpace: "pre-wrap" }}>{log.message}</span>
                      </div>
                    ))}
                    {project.compilation.status === "running" && (
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: "var(--fgColor-muted)",
                        }}
                      >
                        {renderSpinner()}
                        Compiling...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </LayoutScroll>
    </LayoutColumn>
  );
}

function getLogColor(level: number): string {
  // Assuming Log.LogLevel enum values
  switch (level) {
    case 0: // DEBUG
      return "var(--fgColor-muted)";
    case 1: // INFO
      return "var(--fgColor-default)";
    case 2: // WARN
      return "var(--fgColor-attention)";
    case 3: // ERROR
      return "var(--fgColor-danger)";
    default:
      return "var(--fgColor-default)";
  }
}
