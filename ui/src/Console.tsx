import { PlayIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import { useEffect, useRef, useState } from "react";
import { formatAndColorizeJson } from "./formatter";
import { MethodCall } from "./kaja";
import { methodId } from "./project";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

interface ConsoleProps {
  items: ConsoleItem[];
}

export function Console({ items }: ConsoleProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"request" | "response">("response");
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Filter items into method calls for easier access
  const methodCalls = items
    .map((item, index) => ({ item, index }))
    .filter((entry): entry is { item: MethodCall; index: number } => "method" in entry.item);

  // Get selected method call
  const selectedMethodCall =
    selectedIndex !== null && "method" in items[selectedIndex] ? (items[selectedIndex] as MethodCall) : null;

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
        }}
      >
        <div
          style={{
            width: 300,
            minWidth: 200,
            flexShrink: 0,
            padding: "8px 12px",
            borderRight: "1px solid var(--borderColor-default)",
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
      </div>

      {/* Content row */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left panel - Call list */}
        <div
          ref={listRef}
          style={{
            width: 300,
            minWidth: 200,
            borderRight: "1px solid var(--borderColor-default)",
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

        {/* Right panel - Details */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedMethodCall ? (
            <Console.DetailContent
              methodCall={selectedMethodCall}
              activeTab={activeTab}
              onTabChange={setActiveTab}
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

interface DetailTabsProps {
  methodCall: MethodCall;
  activeTab: "request" | "response";
  onTabChange: (tab: "request" | "response") => void;
}

Console.DetailTabs = function ({ methodCall, activeTab, onTabChange }: DetailTabsProps) {
  const hasResponse = methodCall.output !== undefined || methodCall.error !== undefined;

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
        {!hasResponse && (
          <span style={{ marginLeft: 8, display: "inline-flex" }}>
            <Spinner size="small" />
          </span>
        )}
      </div>
    </div>
  );
};

interface DetailContentProps {
  methodCall: MethodCall;
  activeTab: "request" | "response";
  onTabChange: (tab: "request" | "response") => void;
}

Console.DetailContent = function ({ methodCall, activeTab, onTabChange }: DetailContentProps) {
  const [html, setHtml] = useState<string>("");
  const hasResponse = methodCall.output !== undefined || methodCall.error !== undefined;

  useEffect(() => {
    async function updateHtml() {
      let content: any;
      if (activeTab === "request") {
        content = methodCall.input;
      } else {
        content = methodCall.error || methodCall.output;
      }
      if (content !== undefined) {
        const formatted = await formatAndColorizeJson(content);
        setHtml(formatted);
      } else {
        setHtml("");
      }
    }
    updateHtml();
  }, [methodCall, activeTab]);

  // Switch to response tab when response arrives
  useEffect(() => {
    if (hasResponse && activeTab === "request") {
      onTabChange("response");
    }
  }, [hasResponse]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: 12,
        fontSize: 12,
        fontFamily: "monospace",
      }}
    >
      {activeTab === "response" && !hasResponse ? (
        <div style={{ color: "var(--fgColor-muted)" }}>Waiting for response...</div>
      ) : (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
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
