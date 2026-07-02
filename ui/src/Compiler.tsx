import { CheckIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import { ActionList, Flash, Spinner } from "@primer/react";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { useState } from "react";
import { CompilationStatus, App } from "./apps";
import { appType, appTypeLabel } from "./appTypes";
import { Log, LogLevel } from "./server/api";

interface CompilerProps {
  apps: App[];
  configurationLoaded: boolean;
  // Logs from loading the configuration file, shown when they contain problems
  // and no apps loaded - otherwise a broken kaja.json would fail invisibly.
  configurationLogs?: Log[];
  onNewAppClick?: () => void;
}

const ICON_SIZE = 20;
const CHEVRON_SIZE = 16;
const CHECK_ICON_SIZE = 12;
const LOG_LINE_HEIGHT = 20;
const LOG_FONT_SIZE = 12;
const LOG_PADDING = "12px 16px";
const LINE_NUMBER_WIDTH = "40px";
const LINE_NUMBER_MARGIN = 16;

export function Compiler({ apps, configurationLoaded, configurationLogs, onNewAppClick }: CompilerProps) {
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());

  const toggleExpand = (appName: string) => {
    setExpandedApps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(appName)) {
        newSet.delete(appName);
      } else {
        newSet.add(appName);
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

  if (apps.length === 0) {
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

    const problems = (configurationLogs || []).filter((log) => log.level === LogLevel.LEVEL_WARN || log.level === LogLevel.LEVEL_ERROR);
    if (problems.length > 0) {
      return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, backgroundColor: "var(--bgColor-muted)" }}>
          <div style={{ padding: 16 }}>
            <Flash variant="danger">Failed to load the configuration.</Flash>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, fontFamily: "monospace", fontSize: LOG_FONT_SIZE, padding: LOG_PADDING }}>
            {problems.map((log, index) => (
              <div key={index} style={{ marginBottom: 1, lineHeight: `${LOG_LINE_HEIGHT}px` }}>
                <span style={{ color: getLogColor(log.level), whiteSpace: "pre-wrap" }}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return <FirstAppBlankslate onNewAppClick={onNewAppClick} />;
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
        {apps.map((app, index) => {
          const isExpanded = expandedApps.has(app.configuration.name);
          return (
            <div key={`app-${index}-${app.configuration.name}`} className="compiler-item-wrapper">
              <div className={isExpanded ? "compiler-item-header sticky" : ""}>
                <ActionList>
                  <ActionList.Item
                    variant={getStatusVariant(app.compilation.status)}
                    onSelect={() => toggleExpand(app.configuration.name)}
                    className={isExpanded ? "compiler-item-expanded" : ""}
                  >
                    <ActionList.LeadingVisual>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <ChevronRightIcon size={CHEVRON_SIZE} className={`chevron-icon ${isExpanded ? "expanded" : ""}`} />
                        {getStatusIcon(app.compilation.status)}
                      </div>
                    </ActionList.LeadingVisual>
                    {app.configuration.name}
                    <ActionList.Description>
                      {appTypeLabel(appType(app.configuration))}
                      {app.target ? ` • ${app.target}` : ""}
                    </ActionList.Description>
                    {app.compilation.duration && (
                      <ActionList.TrailingVisual>
                        <span style={{ fontSize: 12, color: "var(--fgColor-muted)" }}>{app.compilation.duration}</span>
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
                    {app.compilation.logs.map((log, logIndex) => (
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
                    {app.compilation.status === "running" && (
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
