import { CheckIcon, XIcon, ChevronRightIcon } from "@primer/octicons-react";
import { ActionList, Spinner, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus, ConfigurationProject, Log, RpcProtocol } from "./server/api";
import { getApiClient } from "./server/connection";

interface IgnoreToken {
  ignore: boolean;
}

interface CompilerProps {
  onProjects: (projects: Project[]) => void;
  autoCompile?: boolean;
}

interface ProjectCompileState {
  project: ConfigurationProject;
  status: "pending" | "running" | "success" | "error";
  logs: Log[];
  isExpanded: boolean;
  duration?: string;
}

// Cache compilation states outside component to persist across mounts/unmounts
let cachedProjectStates: ProjectCompileState[] = [];
let cachedProjects: (Project | null)[] = [];

export function Compiler({ onProjects, autoCompile = true }: CompilerProps) {
  const [projectStates, setProjectStates] = useState<ProjectCompileState[]>(cachedProjectStates);
  const projects = useRef<(Project | null)[]>(cachedProjects);
  const client = getApiClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const startTime = useRef<{ [key: string]: number }>({});

  const compile = async (ignoreToken: IgnoreToken, configurationProject: ConfigurationProject, logOffset: number, projectIndex: number) => {
    if (!startTime.current[configurationProject.name]) {
      startTime.current[configurationProject.name] = Date.now();
    }

    const { response } = await client.compile({
      logOffset,
      force: true,
      projectName: configurationProject.name,
      workspace: configurationProject.workspace,
    });

    if (ignoreToken.ignore) {
      return;
    }

    setProjectStates((states) => {
      const newStates = [...states];
      if (newStates[projectIndex]) {
        newStates[projectIndex].logs = [...newStates[projectIndex].logs, ...response.logs];
        if (response.status === CompileStatus.STATUS_RUNNING) {
          newStates[projectIndex].status = "running";
        }
      }
      cachedProjectStates = newStates;
      return newStates;
    });

    if (response.status === CompileStatus.STATUS_RUNNING) {
      setTimeout(() => {
        compile(ignoreToken, configurationProject, logOffset + response.logs.length, projectIndex);
      }, 1000);
    } else {
      const endTime = Date.now();
      const duration = Math.round((endTime - startTime.current[configurationProject.name]) / 1000);
      const durationStr = duration >= 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`;

      setProjectStates((states) => {
        const newStates = [...states];
        if (newStates[projectIndex]) {
          newStates[projectIndex].status = response.status === CompileStatus.STATUS_READY ? "success" : "error";
          newStates[projectIndex].duration = durationStr;
        }
        cachedProjectStates = newStates;
        return newStates;
      });

      if (response.status === CompileStatus.STATUS_READY) {
        const project = await loadProject(response.sources, configurationProject);
        console.log(`Project loaded [${projectIndex}]:`, project);
        projects.current[projectIndex] = project;
        cachedProjects[projectIndex] = project;
      } else {
        console.log(`Project compilation failed [${projectIndex}]: ${configurationProject.name}`);
        projects.current[projectIndex] = null;
        cachedProjects[projectIndex] = null;
      }

      // Check if all projects have finished compiling (either success or error)
      const processedCount = projects.current.filter((p) => p !== undefined).length;
      const totalCount = projects.current.length;
      console.log(`Projects status: ${totalCount} total, processed: ${processedCount}`);

      if (processedCount === totalCount && totalCount > 0) {
        const validProjects = projects.current.filter((p): p is Project => p !== null && p !== undefined);
        console.log(`All projects processed. Valid projects: ${validProjects.length}`);
        if (validProjects.length > 0) {
          console.log("Calling onProjects with valid projects:", validProjects);
          onProjects(validProjects);
        } else {
          console.log("No valid projects to pass to onProjects");
        }
      }
    }
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };

    client.getConfiguration({}).then(({ response }) => {
      console.log("Configuration", response.configuration);
      console.log("Projects to compile:", response.configuration?.projects);

      const configProjects = response.configuration?.projects || [];

      if (configProjects.length === 0) {
        console.warn("No projects found in configuration");
        return;
      }

      const initialStates: ProjectCompileState[] = configProjects.map((project) => ({
        project,
        status: "pending",
        logs: response.logs || [],
        isExpanded: false,
      }));

      // Only reset state if this is a fresh compile (not using cached data)
      if (autoCompile || cachedProjectStates.length === 0) {
        setProjectStates(initialStates);
        cachedProjectStates = initialStates;

        // Initialize projects array with the correct length
        projects.current = new Array(configProjects.length);
        cachedProjects = new Array(configProjects.length);
        console.log(`Initialized projects array with length: ${configProjects.length}`);
      } else if (cachedProjectStates.length > 0) {
        // Restore cached state when not auto-compiling
        setProjectStates(cachedProjectStates);
        projects.current = cachedProjects;
      }

      if (autoCompile && cachedProjectStates.every((state) => state.status === "pending")) {
        configProjects.forEach((configurationProject, index) => {
          console.log(`Starting compilation for project ${index}: ${configurationProject.name}`);
          compile(ignoreToken, configurationProject, 0, index);
        });
      }
    });

    return () => {
      ignoreToken.ignore = true;
    };
  }, [autoCompile]);


  const toggleExpand = (index: number) => {
    console.log(`Toggling expand for index ${index}`);
    setProjectStates((states) => {
      const newStates = states.map((state, i) => ({
        ...state,
        isExpanded: i === index ? !state.isExpanded : state.isExpanded,
      }));
      cachedProjectStates = newStates;
      return newStates;
    });
  };

  const getStatusVariant = (status: ProjectCompileState["status"]) => {
    switch (status) {
      case "error":
        return "danger";
      default:
        return undefined;
    }
  };

  const getStatusIcon = (status: ProjectCompileState["status"]) => {
    const iconStyle = {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 20,
      height: 20,
      borderRadius: "50%",
      backgroundColor: status === "success" ? "var(--bgColor-success-muted)" : status === "error" ? "var(--bgColor-danger-muted)" : "transparent",
    };

    switch (status) {
      case "running":
        return (
          <div className="spinner-rotating" style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Spinner size="small" />
          </div>
        );
      case "success":
        return (
          <div style={iconStyle}>
            <CheckIcon size={12} fill="var(--fgColor-success)" />
          </div>
        );
      case "error":
        return (
          <div style={iconStyle}>
            <XIcon size={12} fill="var(--fgColor-danger)" />
          </div>
        );
      default:
        return null;
    }
  };

  const getProtocolDisplay = (protocol: RpcProtocol) => {
    return protocol === RpcProtocol.GRPC ? "gRPC" : "Twirp";
  };

  return (
    <div
      ref={containerRef}
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
      {projectStates.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fgColor-muted)" }}>
          <div>
            <Spinner size="medium" />
            <div style={{ marginTop: 12 }}>Loading configuration...</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: "1 1 0", overflowY: "auto", minHeight: 0 }}>
          {projectStates.map((state, index) => (
            <div 
              key={`project-${index}-${state.project.name}`}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className="compiler-item-wrapper"
            >
              <div className={state.isExpanded ? "compiler-item-header sticky" : ""}>
                <ActionList>
                  <ActionList.Item
                    variant={getStatusVariant(state.status)}
                    onSelect={() => toggleExpand(index)}
                    className={state.isExpanded ? "compiler-item-expanded" : ""}
                  >
                    <ActionList.LeadingVisual>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <ChevronRightIcon size={16} className={`chevron-icon ${state.isExpanded ? "expanded" : ""}`} />
                        {getStatusIcon(state.status)}
                      </div>
                    </ActionList.LeadingVisual>
                    {state.project.name}
                    <ActionList.Description>
                      {getProtocolDisplay(state.project.protocol)} • {state.project.url}
                    </ActionList.Description>
                    {state.duration && (
                      <ActionList.TrailingVisual>
                        <Text sx={{ fontSize: 1, color: "fg.muted" }}>{state.duration}</Text>
                      </ActionList.TrailingVisual>
                    )}
                  </ActionList.Item>
                </ActionList>
              </div>
              {state.isExpanded && (
                <div className="compiler-logs-container">
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      padding: "12px 16px",
                    }}
                  >
                    {state.logs.map((log, logIndex) => (
                      <div
                        key={logIndex}
                        style={{
                          display: "flex",
                          marginBottom: 1,
                          lineHeight: "20px",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--fgColor-muted)",
                            minWidth: "40px",
                            textAlign: "right",
                            marginRight: 16,
                            userSelect: "none",
                          }}
                        >
                          {logIndex + 1}
                        </span>
                        <span style={{ color: getLogColor(log.level), whiteSpace: "pre-wrap" }}>{log.message}</span>
                      </div>
                    ))}
                    {state.status === "running" && (
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: "var(--fgColor-muted)",
                        }}
                      >
                        <div className="spinner-rotating" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Spinner size="small" />
                        </div>
                        Compiling...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
