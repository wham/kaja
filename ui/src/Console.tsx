import { Check, ChevronDown, ChevronUp, ChevronsUpDown, Copy, FoldVertical, Trash2, UnfoldVertical } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useRef, useState } from "react";
import { formatClockTime, formatDayLabel, formatElapsed, isSameDay } from "./callTime";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { isCallInFlight, MethodCall } from "./kaja";
import { methodId } from "./apps";
import { runShortcutLabel } from "./RunButton";
import { Log, LogLevel } from "./server/api";

export type ConsoleItem = Log[] | MethodCall;

// The dropdown is a fixed 420px and scrolls after eight rows, so a long session
// never turns the console header into a full-height surface.
const CALL_ROW_HEIGHT = 32;
const MAX_VISIBLE_CALL_ROWS = 8;
// Beyond this the qualified call name is truncated from the left, so the method
// — the part that identifies the call — survives.
const MAX_TRIGGER_NAME_LENGTH = 28;
// Both time columns are reserved: the longest value they can ever hold sets the
// geometry once, so nothing moves as calls settle and age.
const DETAIL_COLUMN_CLASS = "w-[9ch] shrink-0 truncate text-right font-mono text-xs tabular-nums text-muted-foreground";
const TIME_COLUMN_CLASS = "w-[8ch] shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground";

const consoleTabClass = "cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground";
const consoleTabActiveClass = "font-medium text-foreground";
// Utilities carry no resting chrome: they are worth no more weight than the tabs
// beside them.
const utilityButtonClass = "h-6 w-6 rounded-md hover:bg-accent hover:text-foreground";

interface ConsoleProps {
  items: ConsoleItem[];
  onClear?: () => void;
}

export function Console({ items, onClear }: ConsoleProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("response");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);

  // A settled call shows the wall-clock time it was made, which never changes —
  // so the clock only runs while something is still in flight, counting up in
  // tenths for the call that is.
  const hasInFlight = items.some((item) => !Array.isArray(item) && isCallInFlight(item));

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [hasInFlight]);

  // Reset selectedIndex when items are cleared or become invalid
  useEffect(() => {
    if (items.length === 0) {
      setSelectedIndex(null);
    } else if (selectedIndex !== null && selectedIndex >= items.length) {
      setSelectedIndex(null);
    }
  }, [items.length, selectedIndex]);

  const selectedItem = selectedIndex !== null ? items[selectedIndex] : undefined;
  const selectedMethodCall = selectedItem && "method" in selectedItem ? selectedItem : null;
  const selectedLogs = Array.isArray(selectedItem) ? selectedItem : null;

  // Follow the newest item, so an in-flight call is selected the moment it is
  // issued instead of after its response lands.
  useEffect(() => {
    if (items.length === 0) return;
    const lastIndex = items.length - 1;
    if (selectedIndex === null || selectedIndex >= lastIndex - 1) {
      setSelectedIndex(lastIndex);
    }
  }, [items.length]);

  // ⌃↑ / ⌃↓ step through the history without opening the dropdown.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (items.length === 0) return;
      event.preventDefault();
      setSelectedIndex((index) => {
        const current = index ?? items.length - 1;
        const next = event.key === "ArrowUp" ? current - 1 : current + 1;
        return Math.max(0, Math.min(items.length - 1, next));
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items.length]);

  const handleCopy = useCallback(() => {
    jsonViewerRef.current?.copyToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, []);

  const showUtilities = selectedMethodCall !== null && (activeTab === "request" || activeTab === "response");
  const position = selectedIndex === null ? items.length : selectedIndex + 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* One row spanning the full console width: which call, how to step through
          them, what to look at, and what to do with it. */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">No calls yet</span>
        ) : (
          <>
            <Console.CallSelect items={items} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onClear={onClear} now={now} />
            <div className="flex items-center gap-1">
              <IconButton
                icon={ChevronUp}
                aria-label="Previous call"
                variant="ghost"
                size="sm"
                tooltip={false}
                className="h-6 w-6"
                disabled={position <= 1}
                onClick={() => setSelectedIndex((index) => Math.max(0, (index ?? items.length - 1) - 1))}
              />
              <IconButton
                icon={ChevronDown}
                aria-label="Next call"
                variant="ghost"
                size="sm"
                tooltip={false}
                className="h-6 w-6"
                disabled={position >= items.length}
                onClick={() => setSelectedIndex((index) => Math.min(items.length - 1, (index ?? items.length - 1) + 1))}
              />
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {position} of {items.length}
              </span>
            </div>
          </>
        )}
        <div className="h-4 w-px bg-border" />
        <Console.DetailTabs methodCall={selectedMethodCall} activeTab={activeTab} onTabChange={setActiveTab} />
        {showUtilities && (
          <div className="ml-auto flex items-center gap-2">
            <IconButton
              icon={FoldVertical}
              aria-label="Fold all"
              variant="ghost"
              size="sm"
              className={utilityButtonClass}
              onClick={() => jsonViewerRef.current?.foldAll()}
            />
            <IconButton
              icon={UnfoldVertical}
              aria-label="Unfold all"
              variant="ghost"
              size="sm"
              className={utilityButtonClass}
              onClick={() => jsonViewerRef.current?.unfoldAll()}
            />
            <div className="h-4 w-px bg-border" />
            <IconButton icon={copied ? Check : Copy} aria-label="Copy JSON" variant="ghost" size="sm" className={utilityButtonClass} onClick={handleCopy} />
          </div>
        )}
      </div>

      {/* The response owns the full width of the console below the header.
          Elevated to the same surface as the editor: payloads are content, the
          header around them is chrome. */}
      <div className="flex min-h-0 flex-1 flex-col bg-muted">
        {selectedMethodCall ? (
          <Console.DetailContent methodCall={selectedMethodCall} activeTab={activeTab} onTabChange={setActiveTab} jsonViewerRef={jsonViewerRef} />
        ) : selectedLogs ? (
          <Console.LogContent logs={selectedLogs} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            Run a script to see its calls here — <span className="ml-1 font-mono">{runShortcutLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface CallSelectProps {
  items: ConsoleItem[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onClear?: () => void;
  now: number;
}

// The whole history behind one 26px trigger: the trigger answers "which run am I
// looking at", the list answers "which other ones are there".
Console.CallSelect = function ({ items, selectedIndex, onSelect, onClear, now }: CallSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedIndex !== null ? items[selectedIndex] : undefined;
  const summary = selected ? itemSummary(selected, now) : undefined;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="console-call-select"
          className="flex h-[26px] min-w-0 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 hover:bg-accent"
          title={summary?.name}
        >
          {summary?.pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", summary?.dotClass)} />}
          <span className="max-w-[190px] truncate font-mono text-xs text-foreground">{truncateStart(summary?.name ?? "", MAX_TRIGGER_NAME_LENGTH)}</span>
          {summary?.detail && (
            <span className={DETAIL_COLUMN_CLASS} title={summary.detail}>
              {summary.detail}
            </span>
          )}
          {summary?.time && <span className={TIME_COLUMN_CLASS}>{summary.time}</span>}
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-[420px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs tracking-[0.06em] text-muted-foreground">RECENT CALLS</span>
          <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: MAX_VISIBLE_CALL_ROWS * CALL_ROW_HEIGHT }}>
          {dayGroupedRows(items, now).map(({ item, index, summary, dayLabel }) => (
            <Fragment key={"method" in item ? `mc:${item.id}` : `log:${index}`}>
              {dayLabel && <div className="px-3 pb-1 pt-2 font-mono text-[11px] text-muted-foreground/70">{dayLabel}</div>}
              <Console.CallRow {...summary} index={index} isSelected={index === selectedIndex} onSelect={onSelect} />
            </Fragment>
          ))}
        </div>
        {onClear && (
          <DropdownMenuItem
            className="h-8 gap-2 rounded-none border-t border-border px-3 text-xs text-muted-foreground"
            onSelect={() => {
              onClear();
              setOpen(false);
            }}
          >
            <Trash2 size={13} />
            Clear history
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface CallRowProps extends ItemSummary {
  index: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
}

// Memoized so the tick that counts up an in-flight call only re-renders that
// call's row; every settled row holds a value that no longer changes. Both
// columns are rendered even when empty, so the list stays aligned.
Console.CallRow = memo(function CallRow({ name, detail, time, dotClass, pending, index, isSelected, onSelect }: CallRowProps) {
  return (
    <DropdownMenuItem data-testid="console-row" className={cn("h-8 gap-3 rounded-none px-3", isSelected && "bg-accent")} onSelect={() => onSelect(index)}>
      {pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{name}</span>
      <span className={DETAIL_COLUMN_CLASS} title={detail}>
        {detail}
      </span>
      <span className={TIME_COLUMN_CLASS}>{time}</span>
    </DropdownMenuItem>
  );
});

type ConsoleTab = "request" | "response" | "headers";

interface DetailTabsProps {
  methodCall: MethodCall | null;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

Console.DetailTabs = function ({ methodCall, activeTab, onTabChange }: DetailTabsProps) {
  const isStreaming = methodCall?.streamOutputs !== undefined;
  const streamCount = isStreaming ? methodCall!.streamOutputs!.length : 0;

  const tab = (id: ConsoleTab, label: string) => (
    <span className={cn(consoleTabClass, activeTab === id && consoleTabActiveClass)} onClick={() => methodCall && onTabChange(id)}>
      {label}
    </span>
  );

  // A failed call colours its dot and its status line, and nothing else — the
  // header stays neutral.
  return (
    <div className={cn("flex items-center gap-4", !methodCall && "pointer-events-none opacity-40")}>
      {tab("request", "Request")}
      {tab("response", `Response${isStreaming && streamCount > 0 ? ` (${streamCount})` : ""}`)}
      {tab("headers", "Headers")}
    </div>
  );
};

interface LogContentProps {
  logs: Log[];
}

Console.LogContent = function ({ logs }: LogContentProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs">
      {logs.map((log, index) => (
        <div key={index} className={cn("whitespace-pre-wrap break-words", classForLogLevel(log.level))}>
          <span className="mr-2 text-[10px] uppercase opacity-70">{labelForLogLevel(log.level)}</span>
          {log.message.trim()}
        </div>
      ))}
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
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Waiting for a response…</div>
      ) : (
        <>
          {activeTab === "response" && <Console.ResponseSummary methodCall={methodCall} content={content} rawText={rawText} />}
          {activeTab === "response" && hasError && methodCall.url && (
            <div className="border-b border-border bg-destructive/10 px-4 py-1.5 font-mono text-xs text-destructive">POST {methodCall.url}</div>
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
// big it is. Without it a successful call and an empty one look the same. Status
// colour appears here and in the call's dot, and nowhere else.
Console.ResponseSummary = function ({ methodCall, content, rawText }: ResponseSummaryProps) {
  const status = callStatus(methodCall);
  const label = { pending: "Pending", streaming: "Streaming", success: "OK", error: callErrorCode(methodCall) ?? "Error" }[status];
  const duration = formatDuration(methodCall.durationMs);
  const size = formatBytes(payloadBytes(content, rawText));
  const streamCount = methodCall.streamOutputs?.length;

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap px-4 pb-2 pt-3 font-mono text-xs">
      <span data-testid="console-status" className={cn("shrink-0 font-medium", statusClass(status))}>
        {label}
      </span>
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

interface ItemSummary {
  name: string;
  // Duration, or the status code of a failed call.
  detail?: string;
  // Wall-clock time the call was made.
  time?: string;
  timestamp?: number;
  dotClass: string;
  pending: boolean;
}

// The columns every row in the history shares — the trigger shows them for the
// selected item, the list for all of them.
function itemSummary(item: ConsoleItem, now: number): ItemSummary {
  if (Array.isArray(item)) {
    const level = item.length === 0 ? LogLevel.LEVEL_INFO : Math.max(...item.map((log) => log.level));
    return {
      name: item.length === 1 ? item[0].message.trim() : `${item.length} log messages`,
      detail: labelForLogLevel(level),
      dotClass: dotClassForLogLevel(level),
      pending: false,
    };
  }

  const status = callStatus(item);
  const pending = status === "pending" || status === "streaming";
  return {
    name: methodId(item.service, item.method),
    // While the call is in flight its own elapsed time is the interesting
    // number; once it lands, how long it took.
    detail: pending ? formatElapsed(now - item.timestamp) : (callErrorCode(item) ?? formatDuration(item.durationMs)),
    time: formatClockTime(item.timestamp),
    timestamp: item.timestamp,
    dotClass: dotClass(status),
    pending,
  };
}

interface DayGroupedRow {
  item: ConsoleItem;
  index: number;
  summary: ItemSummary;
  // Set on the first row of a day other than today, which is where the list
  // says what day it has moved to.
  dayLabel?: string;
}

// Newest first, so a label lands on the first row of each day the list moves
// back into; today needs none.
function dayGroupedRows(items: ConsoleItem[], now: number): DayGroupedRow[] {
  const rows = items.map((item, index) => ({ item, index, summary: itemSummary(item, now) })).reverse();
  let previousTimestamp = now;
  return rows.map((row) => {
    const timestamp = row.summary.timestamp;
    if (timestamp === undefined) return row;
    const dayLabel = isSameDay(timestamp, previousTimestamp) ? undefined : formatDayLabel(timestamp);
    previousTimestamp = timestamp;
    return { ...row, dayLabel };
  });
}

// Keep the tail — for a qualified call name that is the method, the part that
// says which call this is.
function truncateStart(text: string, maxLength: number): string {
  return text.length > maxLength ? `…${text.slice(text.length - maxLength + 1)}` : text;
}

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

function dotClass(status: CallStatus): string {
  return {
    pending: "bg-muted-foreground",
    streaming: "bg-primary",
    success: "bg-emerald-500",
    error: "bg-red-500",
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

function dotClassForLogLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_WARN:
      return "bg-amber-500";
    case LogLevel.LEVEL_ERROR:
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}
