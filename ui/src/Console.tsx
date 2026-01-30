import { PlayIcon, TrashIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { Gutter } from "./Gutter";
import { JsonViewer } from "./JsonViewer";
import { MethodCall } from "./kaja";
import { methodId } from "./project";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

interface ConsoleProps {
  items: ConsoleItem[];
  onClear?: () => void;
  colorMode?: "day" | "night";
}

export function Console({ items, onClear, colorMode = "night" }: ConsoleProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"request" | "response" | "headers">("response");
  const [callListWidth, setCallListWidth] = useState(300);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Reset selectedIndex when items are cleared or become invalid
  useEffect(() => {
    if (items.length === 0) {
      setSelectedIndex(null);
    } else if (selectedIndex !== null && selectedIndex >= items.length) {
      setSelectedIndex(null);
    }
  }, [items.length, selectedIndex]);

  const onCallListResize = (delta: number) => {
    setCallListWidth((prev) => Math.max(150, Math.min(600, prev + delta)));
  };

  // Filter items into method calls for easier access
  const methodCalls = items
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { item: MethodCall; index: number } => "method" in entry.item);

  // Get selected method call
  const selectedMethodCall =
    selectedIndex !== null && items[selectedIndex] && "method" in items[selectedIndex]
      ? (items[selectedIndex] as MethodCall)
      : null;

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items]);

  // Auto-select latest method call
  useEffect(() => {
    if (methodCalls.length > 0) {
      const latest = methodCalls[methodCalls.length - 1];
      setSelectedIndex(latest.index);
    }
  }, [items.length]);

  const handleRowClick = (index: number) => {
    autoScrollRef.current = false;
    setSelectedIndex(index);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <style>{`
        .console-row {
          display: flex;
          align-items: center;
          padding: 6px 12px;
          cursor: pointer;
          border-bottom: 1px solid var(--borderColor-muted);
          font-size: 12px;
          font-family: monospace;
        }
        .console-row:hover {
          background-color: var(--bgColor-neutral-muted);
        }
        .console-row.selected {
          background-color: var(--bgColor-accent-muted);
        }
        .console-row.selected:hover {
          background-color: var(--bgColor-accent-muted);
        }
        .console-tab {
          padding: 8px 16px;
          cursor: pointer;
          font-size: 12px;
          font-family: monospace;
          border-bottom: 2px solid transparent;
          color: var(--fgColor-muted);
        }
        .console-tab:hover {
          color: var(--fgColor-default);
        }
        .console-tab.active {
          color: var(--fgColor-default);
          border-bottom-color: var(--fgColor-accent);
        }
      `}</style>

      {/* Header row */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--borderColor-default)",
          position: "relative",
          height: 35,
        }}
      >
        <div
          style={{
            width: callListWidth,
            flexShrink: 0,
            padding: "10px 12px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--fgColor-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Calls
        </div>
        {selectedMethodCall && (
          <Console.DetailTabs
            methodCall={selectedMethodCall}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}
        {onClear && items.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 20,
              background: "var(--bgColor-muted)",
              borderRadius: 6,
              padding: 2,
            }}
          >
            <IconButton
              icon={TrashIcon}
              aria-label="Clear console"
              size="small"
              variant="invisible"
              onClick={onClear}
            />
          </div>
        )}
      </div>

      {/* Content row */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left panel - Call list */}
        <div
          ref={listRef}
          style={{
            width: callListWidth,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          {items.map((item, index) => {
            if (Array.isArray(item)) {
              return <Console.LogRow key={index} logs={item} />;
            } else if ("method" in item) {
              return (
                <Console.MethodCallRow
                  key={index}
                  methodCall={item}
                  isSelected={selectedIndex === index}
                  onClick={() => handleRowClick(index)}
                />
              );
            }
            return null;
          })}
        </div>

        <Gutter orientation="vertical" onResize={onCallListResize} />

        {/* Right panel - Details */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedMethodCall ? (
            <Console.DetailContent
              methodCall={selectedMethodCall}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              colorMode={colorMode}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                color: "var(--fgColor-muted)",
                fontSize: 12,
              }}
            >
              Press <PlayIcon size={12} /> to run
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface LogRowProps {
  logs: Log[];
}

Console.LogRow = function ({ logs }: LogRowProps) {
  if (logs.length === 0) return null;

  // Show summary of logs with highest severity
  const highestSeverity = Math.max(...logs.map((l) => l.level));
  const color = colorForLogLevel(highestSeverity);

  return (
    <div
      className="console-row"
      style={{ color, opacity: 0.8 }}
      title={logs.map((l) => l.message).join("\n")}
    >
      <span style={{ marginRight: 8, fontSize: 10 }}>LOG</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {logs.length === 1 ? logs[0].message.trim() : `${logs.length} log messages`}
      </span>
    </div>
  );
};

interface MethodCallRowProps {
  methodCall: MethodCall;
  isSelected: boolean;
  onClick: () => void;
}

Console.MethodCallRow = function ({ methodCall, isSelected, onClick }: MethodCallRowProps) {
  const status = methodCall.error ? "error" : methodCall.output ? "success" : "pending";

  const statusColor = {
    pending: "var(--fgColor-muted)",
    success: "var(--fgColor-success)",
    error: "var(--fgColor-danger)",
  }[status];

  const statusIcon = {
    pending: "○",
    success: "●",
    error: "●",
  }[status];

  return (
    <div className={`console-row ${isSelected ? "selected" : ""}`} onClick={onClick}>
      <span style={{ color: statusColor, marginRight: 8, fontSize: 10 }}>{statusIcon}</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--fgColor-default)",
        }}
      >
        {methodId(methodCall.service, methodCall.method)}
      </span>
    </div>
  );
};

type ConsoleTab = "request" | "response" | "headers";

interface DetailTabsProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

Console.DetailTabs = function ({ methodCall, activeTab, onTabChange }: DetailTabsProps) {
  return (
    <div style={{ display: "flex" }}>
      <div
        className={`console-tab ${activeTab === "request" ? "active" : ""}`}
        onClick={() => onTabChange("request")}
      >
        Request
      </div>
      <div
        className={`console-tab ${activeTab === "response" ? "active" : ""}`}
        onClick={() => onTabChange("response")}
        style={{
          color: methodCall.error
            ? "var(--fgColor-danger)"
            : activeTab === "response"
            ? "var(--fgColor-default)"
            : "var(--fgColor-muted)",
        }}
      >
        Response
      </div>
      <div
        className={`console-tab ${activeTab === "headers" ? "active" : ""}`}
        onClick={() => onTabChange("headers")}
      >
        Headers
      </div>
    </div>
  );
};

interface DetailContentProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  colorMode?: "day" | "night";
}

Console.DetailContent = function ({ methodCall, activeTab, onTabChange, colorMode = "night" }: DetailContentProps) {
  const hasResponse = methodCall.output !== undefined || methodCall.error !== undefined;
  const hasError = methodCall.error !== undefined;

  // Switch to response tab when response arrives
  useEffect(() => {
    if (hasResponse && activeTab === "request") {
      onTabChange("response");
    }
  }, [hasResponse]);

  if (activeTab === "headers") {
    return <Console.HeadersContent methodCall={methodCall} />;
  }

  const content = activeTab === "request" ? methodCall.input : methodCall.error || methodCall.output;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {activeTab === "response" && !hasResponse ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--fgColor-muted)",
            fontSize: 12,
          }}
        >
          Waiting for response...
        </div>
      ) : (
        <>
          {activeTab === "response" && hasError && methodCall.url && (
            <div
              style={{
                padding: "6px 12px",
                fontFamily: "monospace",
                fontSize: 12,
                color: "var(--fgColor-danger)",
                borderBottom: "1px solid var(--borderColor-muted)",
                backgroundColor: "var(--bgColor-danger-muted)",
              }}
            >
              POST {methodCall.url}
            </div>
          )}
          <JsonViewer value={content} colorMode={colorMode} />
        </>
      )}
    </div>
  );
};

interface HeadersContentProps {
  methodCall: MethodCall;
}

Console.HeadersContent = function ({ methodCall }: HeadersContentProps) {
  const requestHeaders = methodCall.requestHeaders || {};
  const responseHeaders = methodCall.responseHeaders || {};
  const hasRequestHeaders = Object.keys(requestHeaders).length > 0;
  const hasResponseHeaders = Object.keys(responseHeaders).length > 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: 16,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--fgColor-default)",
          }}
        >
          Request Headers
        </div>
        {hasRequestHeaders ? (
          <Console.HeadersTable headers={requestHeaders} />
        ) : (
          <div style={{ color: "var(--fgColor-muted)", fontStyle: "italic" }}>No request headers</div>
        )}
      </div>

      <div>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--fgColor-default)",
          }}
        >
          Response Headers
        </div>
        {hasResponseHeaders ? (
          <Console.HeadersTable headers={responseHeaders} />
        ) : (
          <div style={{ color: "var(--fgColor-muted)", fontStyle: "italic" }}>No response headers</div>
        )}
      </div>
    </div>
  );
};

interface HeadersTableProps {
  headers: { [key: string]: string };
}

Console.HeadersTable = function ({ headers }: HeadersTableProps) {
  const sortedKeys = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return (
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
      }}
    >
      <tbody>
        {sortedKeys.map((key) => (
          <tr key={key}>
            <td
              style={{
                padding: "4px 12px 4px 0",
                color: "var(--fgColor-muted)",
                verticalAlign: "top",
                whiteSpace: "nowrap",
              }}
            >
              {key}:
            </td>
            <td
              style={{
                padding: "4px 0",
                color: "var(--fgColor-default)",
                wordBreak: "break-all",
              }}
            >
              {headers[key]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

function colorForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "var(--fgColor-muted)";
    case LogLevel.LEVEL_INFO:
      return "var(--fgColor-default)";
    case LogLevel.LEVEL_WARN:
      return "var(--fgColor-attention)";
    case LogLevel.LEVEL_ERROR:
      return "var(--fgColor-danger)";
  }
}
