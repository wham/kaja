import { ChevronRightIcon, CheckIcon, XIcon } from "@primer/octicons-react";
import { IconButton, Spinner } from "@primer/react";
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
}

interface ProjectCompileState {
  project: ConfigurationProject;
  status: "pending" | "running" | "success" | "error";
  logs: Log[];
  isExpanded: boolean;
  duration?: string;
}

export function Compiler({ onProjects }: CompilerProps) {
  const [projectStates, setProjectStates] = useState<ProjectCompileState[]>([]);
  const [stickyIndex, setStickyIndex] = useState<number | null>(null);
  const projects = useRef<(Project | null)[]>([]);
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
        return newStates;
      });

      if (response.status === CompileStatus.STATUS_READY) {
        const project = await loadProject(response.sources, configurationProject);
        console.log(`Project loaded [${projectIndex}]:`, project);
        projects.current[projectIndex] = project;
      } else {
        console.log(`Project compilation failed [${projectIndex}]: ${configurationProject.name}`);
        projects.current[projectIndex] = null;
      }
      
      // Check if all projects have finished compiling (either success or error)
      const processedCount = projects.current.filter(p => p !== undefined).length;
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

      setProjectStates(initialStates);
      
      // Initialize projects array with the correct length
      projects.current = new Array(configProjects.length);
      console.log(`Initialized projects array with length: ${configProjects.length}`);

      configProjects.forEach((configurationProject, index) => {
        console.log(`Starting compilation for project ${index}: ${configurationProject.name}`);
        compile(ignoreToken, configurationProject, 0, index);
      });
    });

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

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
    setProjectStates((states) => {
      const newStates = [...states];
      newStates[index].isExpanded = !newStates[index].isExpanded;
      return newStates;
    });
  };

  const getStatusIcon = (status: ProjectCompileState["status"]) => {
    switch (status) {
      case "running":
        return <Spinner size="small" />;
      case "success":
        return <CheckIcon size={16} fill="var(--fgColor-success)" />;
      case "error":
        return <XIcon size={16} fill="var(--fgColor-danger)" />;
      default:
        return <div style={{ width: 16, height: 16 }} />;
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
        .project-header {
          position: relative;
          display: flex;
          align-items: center;
          padding: 8px 16px;
          border-bottom: 1px solid var(--borderColor-default);
          cursor: pointer;
          background-color: var(--bgColor-default);
        }
        .project-header:hover {
          background-color: var(--bgColor-neutral-muted);
        }
        .project-header.expanded {
          background-color: var(--bgColor-neutral-muted);
          border-bottom: 1px solid var(--borderColor-muted);
        }
        .project-header.sticky {
          position: sticky;
          top: 0;
          z-index: 10;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        }
        .project-logs {
          background-color: var(--bgColor-neutral-muted);
          border-bottom: 1px solid var(--borderColor-default);
          max-height: 600px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 12px;
          padding: 16px;
        }
        .project-logs pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .chevron-icon {
          transition: transform 0.2s;
          color: var(--fgColor-muted);
        }
        .chevron-icon.expanded {
          transform: rotate(90deg);
        }
      `}</style>

      {projectStates.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--fgColor-muted)" }}>
          <Spinner size="medium" />
          <div style={{ marginTop: 12 }}>Loading configuration...</div>
        </div>
      ) : (
        projectStates.map((state, index) => (
          <div key={state.project.name} data-project-index={index}>
            <div
              className={`project-header ${state.isExpanded ? "expanded" : ""} ${stickyIndex === index ? "sticky" : ""}`}
              onClick={() => toggleExpand(index)}
            >
              <div style={{ marginRight: 8 }}>
                <ChevronRightIcon size={16} className={`chevron-icon ${state.isExpanded ? "expanded" : ""}`} />
              </div>

              <div style={{ marginRight: 12 }}>{getStatusIcon(state.status)}</div>

              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ minWidth: 200 }}>
                  <span style={{ fontWeight: 500, color: "var(--fgColor-default)" }}>{state.project.name}</span>
                </div>

                <div style={{ minWidth: 80, color: "var(--fgColor-muted)", fontSize: 14 }}>{getProtocolDisplay(state.project.protocol)}</div>

                <div style={{ flex: 1, color: "var(--fgColor-muted)", fontSize: 14 }}>{state.project.url}</div>

                {state.duration && <div style={{ color: "var(--fgColor-muted)", fontSize: 14 }}>{state.duration}</div>}
              </div>
            </div>

            {state.isExpanded && (
              <div className="project-logs">
                <pre>
                  {state.logs.map((log, logIndex) => (
                    <div key={logIndex} style={{ color: getLogColor(log.level) }}>
                      {log.message}
                    </div>
                  ))}
                  {state.status === "running" && (
                    <div style={{ marginTop: 8 }}>
                      <Spinner size="small" /> Compiling...
                    </div>
                  )}
                </pre>
              </div>
            )}
          </div>
        ))
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
