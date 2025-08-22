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
  const [stickyIndex, setStickyIndex] = useState<number | null>(null);
  const projects = useRef<(Project | null)[]>(cachedProjects);
  const client = getApiClient();
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;

      const expandedIndices = projectStates.map((state, index) => (state.isExpanded ? index : -1)).filter((index) => index !== -1);

      if (expandedIndices.length === 0) {
        setStickyIndex(null);
        return;
      }

      const scrollTop = containerRef.current.scrollTop;
      let currentSticky = null;

      for (const index of expandedIndices) {
        const element = containerRef.current.querySelector(`[data-project-index="${index}"]`);
        if (element) {
          const rect = element.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          if (rect.top <= containerRect.top && rect.bottom > containerRect.top) {
            currentSticky = index;
          }
        }
      }

      setStickyIndex(currentSticky);
    };

    if (containerRef.current) {
      containerRef.current.addEventListener("scroll", handleScroll);
      return () => containerRef.current?.removeEventListener("scroll", handleScroll);
    }
  }, [projectStates]);

  const toggleExpand = (index: number) => {
    console.log(`Toggling expand for index ${index}`);
    setProjectStates((states) => {
      const newStates = states.map((state, i) => (i === index ? { ...state, isExpanded: !state.isExpanded } : state));
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
        return <Spinner size="small" />;
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
        overflowY: "auto",
        backgroundColor: "var(--bgColor-default)",
      }}
    >
      <style>{`
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
        .compiler-item-sticky {
          position: sticky;
          top: 0;
          z-index: 10;
          background-color: var(--bgColor-default);
        }
      `}</style>
      {projectStates.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--fgColor-muted)" }}>
          <Spinner size="medium" />
          <div style={{ marginTop: 12 }}>Loading configuration...</div>
        </div>
      ) : (
        <ActionList>
          {projectStates.map((state, index) => (
            <div key={`project-${index}-${state.project.name}`}>
              <ActionList.Item
                variant={getStatusVariant(state.status)}
                onSelect={() => toggleExpand(index)}
                className={`${state.isExpanded ? "compiler-item-expanded" : ""} ${state.isExpanded && stickyIndex === index ? "compiler-item-sticky" : ""}`}
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
              {state.isExpanded && (
                <div
                  style={{
                    backgroundColor: "var(--bgColor-canvas-inset)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      maxHeight: 400,
                      overflowY: "auto",
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
                        <Spinner size="small" /> Compiling...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </ActionList>
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
