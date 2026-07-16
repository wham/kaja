import { CheckIcon, CopyIcon, FoldIcon, PlayIcon, TrashIcon, UnfoldIcon } from "@primer/octicons-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Gutter } from "./Gutter";
import { IconButton } from "@primer/react";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { MethodCall } from "./kaja";
import { methodId } from "./apps";
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
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

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
  const methodCalls = items.map((item, index) => ({ item, index })).filter((entry): entry is { item: MethodCall; index: number } => "method" in entry.item);

  // Get selected method call
  const selectedMethodCall = selectedIndex !== null && items[selectedIndex] && "method" in items[selectedIndex] ? (items[selectedIndex] as MethodCall) : null;

  // Auto-scroll and auto-select when the last item is selected (or nothing is)
  useEffect(() => {
    if (items.length === 0) return;
    const lastIndex = items.length - 1;
    const prevLastIndex = items.length - 2;
    if (selectedIndex === null || selectedIndex === prevLastIndex || selectedIndex === lastIndex) {
      setSelectedIndex(lastIndex);
      requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    }
  }, [items.length]);

  const handleRowClick = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleCopy = async () => {
    if (jsonViewerRef.current) {
      jsonViewerRef.current.copyToClipboard();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFoldAll = () => {
    if (jsonViewerRef.current) {
      jsonViewerRef.current.foldAll();
    }
  };

  const handleUnfoldAll = () => {
    if (jsonViewerRef.current) {
      jsonViewerRef.current.unfoldAll();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, backgroundColor: "var(--bgColor-default)" }}>
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
          borderBottom: "1px solid var(--borderColor-muted)",
          height: 35,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: callListWidth,
            flexShrink: 0,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--fgColor-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Calls
          </span>
          {onClear && items.length > 0 && <IconButton icon={TrashIcon} aria-label="Clear console" onClick={onClear} size="small" variant="invisible" />}
        </div>
        <div style={{ width: 1, flexShrink: 0, backgroundColor: "var(--borderColor-muted)" }} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
          {selectedMethodCall && <Console.DetailTabs methodCall={selectedMethodCall} activeTab={activeTab} onTabChange={setActiveTab} />}
          {selectedMethodCall && (activeTab === "request" || activeTab === "response") && (
            <div
              style={{
                marginLeft: "auto",
                marginRight: 12,
                background: "var(--bgColor-muted)",
                borderRadius: 6,
                padding: 2,
                display: "flex",
                gap: 2,
              }}
            >
              <IconButton icon={FoldIcon} aria-label="Fold all" onClick={handleFoldAll} size="small" variant="invisible" />
              <IconButton icon={UnfoldIcon} aria-label="Unfold all" onClick={handleUnfoldAll} size="small" variant="invisible" />
              <IconButton icon={copied ? CheckIcon : CopyIcon} aria-label="Copy JSON" onClick={handleCopy} size="small" variant="invisible" />
            </div>
          )}
        </div>
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
              return <Console.LogRow key={`log:${index}`} logs={item} />;
            } else if ("method" in item) {
              return (
                <Console.MethodCallRow
                  key={`mc:${item.id}`}
                  methodCall={item}
                  index={index}
                  isSelected={selectedIndex === index}
                  onSelect={handleRowClick}
                  relativeTime={formatRelativeTime(item.timestamp, now)}
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
              jsonViewerRef={jsonViewerRef}
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
    <div className="console-row" style={{ color, opacity: 0.8 }} title={logs.map((l) => l.message).join("\n")}>
      <span style={{ marginRight: 8, fontSize: 10 }}>{labelForLogLevel(highestSeverity)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {logs.length === 1 ? logs[0].message.trim() : `${logs.length} log messages`}
      </span>
    </div>
  );
};

interface MethodCallRowProps {
  methodCall: MethodCall;
  index: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
  relativeTime: string;
}

// Memoized so the per-second timestamp tick only re-renders rows whose displayed
// relative time actually changed, instead of every row on every tick.
Console.MethodCallRow = memo(function MethodCallRow({ methodCall, index, isSelected, onSelect, relativeTime }: MethodCallRowProps) {
  const isStreaming = methodCall.streamOutputs !== undefined;
  const isStreamActive = isStreaming && !methodCall.streamComplete && !methodCall.error;

  const status = methodCall.error ? "error" : isStreamActive ? "streaming" : methodCall.output ? "success" : "pending";

  const statusColor = {
    pending: "var(--fgColor-muted)",
    streaming: "var(--fgColor-accent)",
    success: "var(--fgColor-success)",
    error: "var(--fgColor-danger)",
  }[status];

  const statusIcon = {
    pending: "○",
    streaming: "◉",
    success: "●",
    error: "●",
  }[status];

  return (
    <div className={`console-row ${isSelected ? "selected" : ""}`} onClick={() => onSelect(index)}>
      <span style={{ color: statusColor, marginRight: 8, fontSize: 10 }}>{statusIcon}</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--fgColor-default)",
          flex: 1,
        }}
      >
        {methodId(methodCall.service, methodCall.method)}
      </span>
      <span
        style={{
          color: "var(--fgColor-muted)",
          fontSize: 11,
          marginLeft: 8,
          flexShrink: 0,
        }}
      >
        {relativeTime}
      </span>
    </div>
  );
});

type ConsoleTab = "request" | "response" | "headers";

interface DetailTabsProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

Console.DetailTabs = function ({ methodCall, activeTab, onTabChange }: DetailTabsProps) {
  const isStreaming = methodCall.streamOutputs !== undefined;
  const streamCount = isStreaming ? methodCall.streamOutputs!.length : 0;

  return (
    <div style={{ display: "flex" }}>
      <div className={`console-tab ${activeTab === "request" ? "active" : ""}`} onClick={() => onTabChange("request")}>
        Request
      </div>
      <div
        className={`console-tab ${activeTab === "response" ? "active" : ""}`}
        onClick={() => onTabChange("response")}
        style={{
          color: methodCall.error ? "var(--fgColor-danger)" : activeTab === "response" ? "var(--fgColor-default)" : "var(--fgColor-muted)",
        }}
      >
        Response{isStreaming && streamCount > 0 ? ` (${streamCount})` : ""}
      </div>
      <div className={`console-tab ${activeTab === "headers" ? "active" : ""}`} onClick={() => onTabChange("headers")}>
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
  jsonViewerRef: React.MutableRefObject<JsonViewerHandle | null>;
}

Console.DetailContent = function ({ methodCall, activeTab, onTabChange, colorMode = "night", jsonViewerRef }: DetailContentProps) {
  const isStreaming = methodCall.streamOutputs !== undefined;
  const hasResponse = methodCall.output !== undefined || methodCall.error !== undefined || (isStreaming && methodCall.streamOutputs!.length > 0);
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

  let content;
  let rawText: string | undefined;
  if (activeTab === "request") {
    content = methodCall.input;
  } else if (hasError) {
    content = methodCall.error;
  } else if (isStreaming) {
    rawText = methodCall.streamOutputs!.map((msg) => JSON.stringify(msg, null, 2)).join("\n\n");
  } else {
    content = methodCall.output;
  }

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
          <JsonViewer ref={jsonViewerRef} value={content} rawText={rawText} colorMode={colorMode} />
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
  const upstreamRequestHeaders = methodCall.upstreamRequestHeaders || {};
  const upstreamResponseHeaders = methodCall.upstreamResponseHeaders || {};
  // An in-process app (e.g. OpenAPI) reports the headers it exchanged with its
  // upstream API. When present, the transport headers (browser ↔ Kaja) become a
  // second, less interesting hop shown below the upstream ones.
  const hasUpstream = Object.keys(upstreamRequestHeaders).length > 0 || Object.keys(upstreamResponseHeaders).length > 0;

  const section = (title: string, headers: { [key: string]: string }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--fgColor-default)" }}>{title}</div>
      {Object.keys(headers).length > 0 ? (
        <Console.HeadersTable headers={headers} />
      ) : (
        <div style={{ color: "var(--fgColor-muted)", fontStyle: "italic" }}>No {title.toLowerCase()}</div>
      )}
    </div>
  );

  const groupHeading = (text: string, caption: string) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--fgColor-default)" }}>{text}</div>
      <div style={{ color: "var(--fgColor-muted)" }}>{caption}</div>
    </div>
  );

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
      {hasUpstream ? (
        <>
          {groupHeading("Upstream", "Headers Kaja exchanged with the API (sensitive values redacted)")}
          {section("Request headers", upstreamRequestHeaders)}
          {section("Response headers", upstreamResponseHeaders)}
          <div style={{ height: 1, background: "var(--borderColor-default)", margin: "0 0 24px" }} />
          {groupHeading("Transport", "Headers between the browser and Kaja")}
          {section("Request headers", requestHeaders)}
          {section("Response headers", responseHeaders)}
        </>
      ) : (
        <>
          {section("Request Headers", requestHeaders)}
          {section("Response Headers", responseHeaders)}
        </>
      )}
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

function labelForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "DEBUG";
    case LogLevel.LEVEL_INFO:
      return "LOG";
    case LogLevel.LEVEL_WARN:
      return "WARN";
    case LogLevel.LEVEL_ERROR:
      return "ERROR";
  }
}

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

function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
