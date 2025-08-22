import { CheckIcon, XIcon, ChevronRightIcon } from "@primer/octicons-react";
import { ActionList, Spinner, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { Project } from "./project";
import { loadProject } from "./projectLoader";
import { CompileStatus as ApiCompileStatus, ConfigurationProject, Log, RpcProtocol } from "./server/api";
import { getApiClient } from "./server/connection";

interface IgnoreToken {
  ignore: boolean;
}

interface CompilerProps {
  onProjects: (projects: Project[]) => void;
  autoCompile?: boolean;
}

type CompileStatus = "pending" | "running" | "success" | "error";

interface ProjectCompileState {
  project: ConfigurationProject;
  status: CompileStatus;
  logs: Log[];
  isExpanded: boolean;
  duration?: string;
}

// Cache compilation states outside component to persist across mounts/unmounts
let cachedProjectStates: ProjectCompileState[] = [];
let cachedProjects: (Project | null)[] = [];

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

export function Compiler({ onProjects, autoCompile = true }: CompilerProps) {
  const [projectStates, setProjectStates] = useState<ProjectCompileState[]>(cachedProjectStates);
  const projects = useRef<(Project | null)[]>(cachedProjects);
  const client = getApiClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const startTime = useRef<{ [key: string]: number }>({});

  const formatDuration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  };

  const updateProjectState = (projectIndex: number, updates: Partial<ProjectCompileState>) => {
    setProjectStates((states) => {
      const newStates = [...states];
      if (newStates[projectIndex]) {
        Object.assign(newStates[projectIndex], updates);
      }
      cachedProjectStates = newStates;
      return newStates;
    });
  };

  const handleCompileComplete = async (response: any, configurationProject: ConfigurationProject, projectIndex: number) => {
    const duration = formatDuration(Date.now() - startTime.current[configurationProject.name]);
    const isReady = response.status === ApiCompileStatus.STATUS_READY;

    updateProjectState(projectIndex, {
      status: isReady ? "success" : "error",
      duration,
    });

    projects.current[projectIndex] = isReady ? await loadProject(response.sources, configurationProject) : null;
    cachedProjects[projectIndex] = projects.current[projectIndex];

    // Check if all projects have finished compiling
    if (projects.current.every((p) => p !== undefined) && projects.current.length > 0) {
      const validProjects = projects.current.filter((p): p is Project => p !== null);
      if (validProjects.length > 0) {
        onProjects(validProjects);
      }
    }
  };

  const compile = async (ignoreToken: IgnoreToken, configurationProject: ConfigurationProject, logOffset: number, projectIndex: number) => {
    startTime.current[configurationProject.name] ??= Date.now();

    const { response } = await client.compile({
      logOffset,
      force: true,
      projectName: configurationProject.name,
      workspace: configurationProject.workspace,
    });

    if (ignoreToken.ignore) return;

    const isRunning = response.status === ApiCompileStatus.STATUS_RUNNING;

    setProjectStates((states) => {
      const newStates = [...states];
      if (newStates[projectIndex]) {
        newStates[projectIndex].logs = [...newStates[projectIndex].logs, ...response.logs];
        if (isRunning) {
          newStates[projectIndex].status = "running";
        }
      }
      cachedProjectStates = newStates;
      return newStates;
    });

    if (isRunning) {
      setTimeout(() => compile(ignoreToken, configurationProject, logOffset + response.logs.length, projectIndex), POLL_INTERVAL_MS);
    } else {
      await handleCompileComplete(response, configurationProject, projectIndex);
    }
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };

    const initializeAndCompile = async () => {
      const { response } = await client.getConfiguration({});
      const configProjects = response.configuration?.projects || [];

      if (configProjects.length === 0) return;

      const initialStates: ProjectCompileState[] = configProjects.map((project) => ({
        project,
        status: "pending",
        logs: response.logs || [],
        isExpanded: false,
      }));

      const shouldResetState = autoCompile || cachedProjectStates.length === 0;

      if (shouldResetState) {
        setProjectStates(initialStates);
        cachedProjectStates = initialStates;
        projects.current = new Array(configProjects.length);
        cachedProjects = new Array(configProjects.length);
      } else if (cachedProjectStates.length > 0) {
        setProjectStates(cachedProjectStates);
        projects.current = cachedProjects;
      }

      const shouldStartCompile = autoCompile && cachedProjectStates.every((state) => state.status === "pending");
      if (shouldStartCompile) {
        configProjects.forEach((project, index) => compile(ignoreToken, project, 0, index));
      }
    };

    initializeAndCompile();

    return () => {
      ignoreToken.ignore = true;
    };
  }, [autoCompile]);

  const toggleExpand = (index: number) => {
    setProjectStates((states) => {
      const newStates = states.map((state, i) => ({
        ...state,
        isExpanded: i === index ? !state.isExpanded : state.isExpanded,
      }));
      cachedProjectStates = newStates;
      return newStates;
    });
  };

  const getStatusVariant = (status: CompileStatus) => {
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

  const getStatusIcon = (status: CompileStatus) => {
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
                        <ChevronRightIcon size={CHEVRON_SIZE} className={`chevron-icon ${state.isExpanded ? "expanded" : ""}`} />
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
                      fontSize: LOG_FONT_SIZE,
                      padding: LOG_PADDING,
                    }}
                  >
                    {state.logs.map((log, logIndex) => (
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
                        {renderSpinner()}
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
