import { CheckIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import { ActionList, Spinner } from "@primer/react";
import { FirstProjectBlankslate } from "./FirstProjectBlankslate";
import { useState } from "react";
import { CompilationStatus, Project } from "./project";
import { RpcProtocol } from "./server/api";

interface CompilerProps {
  projects: Project[];
  configurationLoaded: boolean;
  onNewProjectClick?: () => void;
}

const ICON_SIZE = 20;
const CHEVRON_SIZE = 16;
const CHECK_ICON_SIZE = 12;
const LOG_LINE_HEIGHT = 20;
const LOG_FONT_SIZE = 12;
const LOG_PADDING = "12px 16px";
const LINE_NUMBER_WIDTH = "40px";
const LINE_NUMBER_MARGIN = 16;

export function Compiler({ projects, configurationLoaded, onNewProjectClick }: CompilerProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            alignItems: "center",
            justifyContent: "center",
            color: "var(--fgColor-muted)",
            backgroundColor: "var(--bgColor-muted)",
          }}
        >
          <div>
            <Spinner size="medium" />
            <div style={{ marginTop: 12 }}>Loading configuration...</div>
          </div>
        </div>
      );
    }

    return <FirstProjectBlankslate onNewProjectClick={onNewProjectClick} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, backgroundColor: "var(--bgColor-muted)" }}>
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
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
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
      </div>
    </div>
  );
}

function getLogColor(level: number): string {
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
