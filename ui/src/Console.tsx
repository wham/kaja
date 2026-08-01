import { Check, Copy, FoldVertical, Play, Trash2, UnfoldVertical } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Gutter } from "./Gutter";
import { IconButton } from "./components/icon-button";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { MethodCall } from "./kaja";
import { methodId } from "./apps";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

const consoleRowClass = "flex cursor-pointer items-center border-b border-border px-3 py-1.5 font-mono text-xs";
const consoleTabClass = "cursor-pointer border-b-2 border-transparent px-4 py-2 font-mono text-xs text-muted-foreground hover:text-foreground";
const consoleTabActiveClass = "border-b-primary text-foreground";

interface ConsoleProps {
  items: ConsoleItem[];
  onClear?: () => void;
}

export function Console({ items, onClear }: ConsoleProps) {
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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Header row */}
      <div className="flex h-[35px] shrink-0 border-b border-border">
        <div className="flex shrink-0 items-center justify-between px-3" style={{ width: callListWidth }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Calls</span>
          {onClear && items.length > 0 && <IconButton icon={Trash2} aria-label="Clear console" onClick={onClear} size="sm" variant="ghost" />}
        </div>
        <div className="w-px shrink-0 bg-border" />
        <div className="flex min-w-0 flex-1 items-center">
          {selectedMethodCall && <Console.DetailTabs methodCall={selectedMethodCall} activeTab={activeTab} onTabChange={setActiveTab} />}
          {selectedMethodCall && (activeTab === "request" || activeTab === "response") && (
            <div className="ml-auto mr-3 flex gap-0.5 rounded-md bg-muted p-0.5">
              <IconButton icon={FoldVertical} aria-label="Fold all" onClick={handleFoldAll} size="sm" variant="ghost" />
              <IconButton icon={UnfoldVertical} aria-label="Unfold all" onClick={handleUnfoldAll} size="sm" variant="ghost" />
              <IconButton icon={copied ? Check : Copy} aria-label="Copy JSON" onClick={handleCopy} size="sm" variant="ghost" />
            </div>
          )}
        </div>
      </div>

      {/* Content row */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel - Call list */}
        <div ref={listRef} className="shrink-0 overflow-y-auto" style={{ width: callListWidth }}>
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

        {/* Right panel - Details. Elevated to the same surface as the editor:
            payloads are content, the call list and headers around them are chrome. */}
        <div className="flex min-w-0 flex-1 flex-col bg-muted">
          {selectedMethodCall ? (
            <Console.DetailContent methodCall={selectedMethodCall} activeTab={activeTab} onTabChange={setActiveTab} jsonViewerRef={jsonViewerRef} />
          ) : (
            <div className="flex flex-1 items-center justify-center gap-1.5 text-xs text-muted-foreground">
              Press <Play size={12} /> to run
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

  return (
    <div
      data-testid="console-row"
      className={cn(consoleRowClass, "opacity-80 hover:bg-accent/50", classForLogLevel(highestSeverity))}
      title={logs.map((l) => l.message).join("\n")}
    >
      <span className="mr-2 text-[10px]">{labelForLogLevel(highestSeverity)}</span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{logs.length === 1 ? logs[0].message.trim() : `${logs.length} log messages`}</span>
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
  const status = callStatus(methodCall);
  const errorCode = callErrorCode(methodCall);
  const duration = formatDuration(methodCall.durationMs);

  const statusIcon = {
    pending: "○",
    streaming: "◉",
    success: "●",
    error: "●",
  }[status];

  return (
    <div
      data-testid="console-row"
      className={cn(consoleRowClass, isSelected ? "bg-accent" : "hover:bg-accent/50")}
      onClick={() => onSelect(index)}
      title={new Date(methodCall.timestamp).toLocaleTimeString()}
    >
      <span className={cn("mr-2 text-[10px]", statusClass(status))}>{statusIcon}</span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{methodId(methodCall.service, methodCall.method)}</span>
      {errorCode && <span className="ml-2 shrink-0 overflow-hidden text-ellipsis text-[10px] font-medium text-destructive">{errorCode}</span>}
      {duration && <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{duration}</span>}
      <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{relativeTime}</span>
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
    <div className="flex">
      <div className={cn(consoleTabClass, activeTab === "request" && consoleTabActiveClass)} onClick={() => onTabChange("request")}>
        Request
      </div>
      <div
        className={cn(consoleTabClass, activeTab === "response" && consoleTabActiveClass, methodCall.error && "text-destructive hover:text-destructive")}
        onClick={() => onTabChange("response")}
      >
        Response{isStreaming && streamCount > 0 ? ` (${streamCount})` : ""}
      </div>
      <div className={cn(consoleTabClass, activeTab === "headers" && consoleTabActiveClass)} onClick={() => onTabChange("headers")}>
        Headers
      </div>
    </div>
  );
};

interface DetailContentProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  jsonViewerRef: React.MutableRefObject<JsonViewerHandle | null>;
}

Console.DetailContent = function ({ methodCall, activeTab, onTabChange, jsonViewerRef }: DetailContentProps) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      {activeTab === "response" && !hasResponse ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Waiting for response...</div>
      ) : (
        <>
          {activeTab === "response" && <Console.ResponseSummary methodCall={methodCall} content={content} rawText={rawText} />}
          {activeTab === "response" && hasError && methodCall.url && (
            <div className="border-b border-border bg-destructive/10 px-3 py-1.5 font-mono text-xs text-destructive">POST {methodCall.url}</div>
          )}
          <JsonViewer ref={jsonViewerRef} value={content} rawText={rawText} />
        </>
      )}
    </div>
  );
};

interface ResponseSummaryProps {
  methodCall: MethodCall;
  content: unknown;
  rawText?: string;
}

// A one-line readout above the payload: what came back, how long it took and how
// big it is. Without it a successful call and an empty one look the same.
Console.ResponseSummary = function ({ methodCall, content, rawText }: ResponseSummaryProps) {
  const status = callStatus(methodCall);
  const label = { pending: "Pending", streaming: "Streaming", success: "OK", error: callErrorCode(methodCall) ?? "Error" }[status];
  const duration = formatDuration(methodCall.durationMs);
  const size = formatBytes(payloadBytes(content, rawText));
  const streamCount = methodCall.streamOutputs?.length;

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-border px-3 py-1 font-mono text-[11px]">
      <span className={cn("shrink-0 font-medium", statusClass(status))}>{label}</span>
      {duration && <span className="shrink-0 tabular-nums text-muted-foreground">{duration}</span>}
      {size && <span className="shrink-0 tabular-nums text-muted-foreground">{size}</span>}
      {streamCount !== undefined && (
        <span className="shrink-0 text-muted-foreground">
          {streamCount} {streamCount === 1 ? "message" : "messages"}
        </span>
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
    <div className="mb-6">
      <div className="mb-2 font-semibold text-foreground">{title}</div>
      {Object.keys(headers).length > 0 ? (
        <Console.HeadersTable headers={headers} />
      ) : (
        <div className="italic text-muted-foreground">No {title.toLowerCase()}</div>
      )}
    </div>
  );

  const groupHeading = (text: string, caption: string) => (
    <div className="mb-3">
      <div className="font-semibold uppercase tracking-wider text-foreground">{text}</div>
      <div className="text-muted-foreground">{caption}</div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
      {hasUpstream ? (
        <>
          {groupHeading("Upstream", "Headers Kaja exchanged with the API")}
          {section("Request headers", upstreamRequestHeaders)}
          {section("Response headers", upstreamResponseHeaders)}
          <div className="mb-6 h-px bg-border" />
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
    <table className="w-full border-collapse">
      <tbody>
        {sortedKeys.map((key) => (
          <tr key={key}>
            <td className="whitespace-nowrap py-1 pr-3 align-top text-muted-foreground">{key}:</td>
            <td className="break-all py-1 text-foreground">{headers[key]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

type CallStatus = "pending" | "streaming" | "success" | "error";

function callStatus(methodCall: MethodCall): CallStatus {
  if (methodCall.error) return "error";
  const isStreaming = methodCall.streamOutputs !== undefined;
  if (isStreaming && !methodCall.streamComplete) return "streaming";
  return methodCall.output ? "success" : "pending";
}

function statusClass(status: CallStatus): string {
  return {
    pending: "text-muted-foreground",
    streaming: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    error: "text-destructive",
  }[status];
}

// gRPC and Twirp errors carry a status code (e.g. "INVALID_ARGUMENT"); anything
// else just shows as a plain error.
function callErrorCode(methodCall: MethodCall): string | undefined {
  const code = methodCall.error?.code;
  return typeof code === "string" && code.length > 0 && code.length <= 24 ? code : undefined;
}

function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined) return undefined;
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
}

function payloadBytes(content: unknown, rawText?: string): number | undefined {
  let text = rawText;
  if (text === undefined) {
    if (content === undefined) return undefined;
    try {
      text = JSON.stringify(content);
    } catch {
      return undefined;
    }
  }
  return text === undefined ? undefined : new TextEncoder().encode(text).length;
}

function formatBytes(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function classForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_DEBUG:
      return "text-muted-foreground";
    case LogLevel.LEVEL_INFO:
      return "text-foreground";
    case LogLevel.LEVEL_WARN:
      return "text-amber-600 dark:text-amber-400";
    case LogLevel.LEVEL_ERROR:
      return "text-destructive";
  }
}

// Kept short so the row still has room for the status and duration; the row's
// tooltip carries the exact time.
function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
