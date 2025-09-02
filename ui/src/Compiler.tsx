import { CheckIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import { ActionList, Spinner, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { CompilationStatus, Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus as ApiCompileStatus, RpcProtocol } from "./server/api";
import { getApiClient } from "./server/connection";

interface CompilerProps {
  projects: Project[];
  onUpdate: (projects: Project[]) => void;
  autoCompile?: boolean;
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

export function Compiler({ projects, onUpdate, autoCompile = true }: CompilerProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const client = getApiClient();
  const abortControllers = useRef<{ [key: string]: AbortController }>({});
  const projectsRef = useRef(projects);
  
  // Keep projectsRef updated
  projectsRef.current = projects;

  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  };

  const compile = async (projectIndex: number) => {
    const project = projects[projectIndex];
    if (!project) return;

    const projectName = project.configuration.name;
    
    // Create abort controller for this compilation
    if (abortControllers.current[projectName]) {
      abortControllers.current[projectName].abort();
    }
    abortControllers.current[projectName] = new AbortController();
    const signal = abortControllers.current[projectName].signal;

    try {
      // Set initial running state with start time
      const updatedProjects = [...projects];
      updatedProjects[projectIndex] = {
        ...project,
        compilation: {
          ...project.compilation,
          status: "running",
          startTime: Date.now(),
          logOffset: 0,
        },
      };
      onUpdate(updatedProjects);

      // Start polling
      await pollCompilation(projectIndex, signal);
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Compilation error:', error);
      }
    }
  };

  const pollCompilation = async (projectIndex: number, signal: AbortSignal) => {
    while (!signal.aborted) {
      const project = projectsRef.current[projectIndex];
      if (!project) return;

      const { response } = await client.compile({
        logOffset: project.compilation.logOffset || 0,
        force: true,
        projectName: project.configuration.name,
        workspace: project.configuration.workspace,
      });

      if (signal.aborted) return;

      const isRunning = response.status === ApiCompileStatus.STATUS_RUNNING;
      const isReady = response.status === ApiCompileStatus.STATUS_READY;
      
      // Update with new logs
      const updatedProjects = [...projectsRef.current];
      const currentProject = updatedProjects[projectIndex];
      const newLogs = [...(currentProject.compilation.logs || []), ...response.logs];
      const newLogOffset = (currentProject.compilation.logOffset || 0) + response.logs.length;

      if (isRunning) {
        updatedProjects[projectIndex] = {
          ...currentProject,
          compilation: {
            ...currentProject.compilation,
            status: "running",
            logs: newLogs,
            logOffset: newLogOffset,
          },
        };
        onUpdate(updatedProjects);
        
        // Continue polling
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        // Compilation complete
        const duration = formatDuration(Date.now() - (currentProject.compilation.startTime || 0));
        
        if (isReady) {
          const loadedProject = await loadProject(response.sources, currentProject.configuration);
          updatedProjects[projectIndex] = {
            ...loadedProject,
            compilation: {
              status: "success",
              logs: newLogs,
              duration,
            },
          };
        } else {
          updatedProjects[projectIndex] = {
            ...currentProject,
            compilation: {
              status: "error",
              logs: newLogs,
              duration,
            },
          };
        }
        
        onUpdate(updatedProjects);
        delete abortControllers.current[currentProject.configuration.name];
        return;
      }
    }
  };

  useEffect(() => {
    // Initialize projects if needed
    const initializeProjects = async () => {
      if (projects.length === 0) {
        // Load initial configuration
        const { response } = await client.getConfiguration({});
        const configProjects = response.configuration?.projects || [];

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
        }));

        onUpdate(initialProjects);
      }
    };

    initializeProjects();
  }, []);

  // Start compilation for pending projects
  useEffect(() => {
    if (autoCompile && projects.length > 0) {
      projects.forEach((project, index) => {
        // Only compile if status is exactly "pending" (not running, success, or error)
        if (project.compilation.status === "pending") {
          compile(index);
        }
      });
    }
  }, [projects, autoCompile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort all ongoing compilations
      Object.values(abortControllers.current).forEach(controller => {
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
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
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
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bgColor-default)",
      }}
    >
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
      <div style={{ flex: "1 1 0", overflowY: "auto", minHeight: 0 }}>
        {projects.map((project, index) => {
          const isExpanded = expandedProjects.has(project.configuration.name);
          return (
            <div
              key={`project-${index}-${project.configuration.name}`}
              className="compiler-item-wrapper"
            >
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
                        <Text sx={{ fontSize: 1, color: "fg.muted" }}>{project.compilation.duration}</Text>
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
      </div>
    </div>
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