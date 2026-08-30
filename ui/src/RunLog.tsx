import { ArrowDown, Check, Copy, FoldVertical, UnfoldVertical } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { barFraction, callErrorCode, dotClass, formatBytes, formatDuration, payloadBytes, statusClass } from "./callFormat";
import { formatClockTime, formatElapsed } from "./callTime";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { fetchRequestLine } from "./fetchCall";
import { unwrapEnvelope } from "./httpEnvelope";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { KajaTrace } from "./KajaTrace";
import { callDurationMs, callLabel, MethodCall } from "./kaja";
import { callStatus, ConsoleItem, ConsoleTab, itemStatus, LogFloor, printedLevel, RunGroup, RunStatus } from "./runs";
import { runShortcutLabel } from "./RunButton";
import { LogLevel } from "./server/api";
import { unwrapFailure, upstreamRequestLine } from "./upstreamHeaders";

// A fixed height is what lets the log virtualise and lets the tail bar say how many
// rows are below without measuring any of them.
const CALL_ROW_HEIGHT = 24;
// Rows rendered beyond each edge of the viewport, so a scroll doesn't reveal blanks.
const OVERSCAN = 8;
// How close to the bottom still counts as following the tail.
const TAIL_SLACK = CALL_ROW_HEIGHT * 2;
// How much of the pane the log may take before the payload stops shrinking. The
// payload is the thing being read; the log is how you choose it.
const MAX_LOG_HEIGHT = "45%";
const BAR_WIDTH = 88;
// Reserves the longest value it can ever hold, so the geometry is set once and
// nothing moves as calls settle and age.
const DURATION_COLUMN_CLASS = "w-[9ch] shrink-0 truncate text-right font-mono text-xs tabular-nums text-muted-foreground";

const payloadTabClass = "cursor-pointer select-none whitespace-nowrap text-xs text-muted-foreground hover:text-foreground";
const payloadTabActiveClass = "font-medium text-foreground";
// Same weight as the console header's utilities: no resting chrome.
const utilityButtonClass = "h-6 w-6 rounded-md hover:bg-accent hover:text-foreground";

interface RunLogProps {
  group: RunGroup;
  rows: ConsoleItem[];
  selectedItemId?: string;
  activeTab: ConsoleTab;
  selectedItem?: ConsoleItem;
  waiting: boolean;
  // So the tail bar can say what is being left out.
  logFloor: LogFloor;
  printed: { lines: number; errors: number };
  now: number;
  tailing: boolean;
  // The same answer, readable without a render — see the note where it is made.
  tailingRef: React.MutableRefObject<boolean>;
  onTailingChange: (tailing: boolean) => void;
  onSelectRow: (itemId: string) => void;
  onTabChange: (tab: ConsoleTab) => void;
  onShowLogs: () => void;
  onGoToCanvas: () => void;
}

/**
 * The flat audit log. A row is a call and only a call, which is what keeps it
 * scannable and lets every row carry the same two extra channels.
 *
 * Only the rows on screen are drawn; the rest are two spacers, because a fixed row
 * height makes the log's length a number rather than a measurement.
 */
export function RunLog({
  group,
  rows,
  selectedItemId,
  activeTab,
  selectedItem,
  waiting,
  logFloor,
  printed,
  now,
  tailing,
  tailingRef,
  onTailingChange,
  onSelectRow,
  onTabChange,
  onShowLogs,
  onGoToCanvas,
}: RunLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ top: 0, height: 0 });
  const onTailingRef = useRef(onTailingChange);
  onTailingRef.current = onTailingChange;

  const total = rows.length;
  const slowest = group.stats.slowest;
  const failures = group.failures;
  const scriptFailed = group.items.some((item) => !item.printed && item.logs?.some((log) => log.level === LogLevel.LEVEL_ERROR));
  // With the floor off that is everything the script printed, which is exactly when
  // the tail bar has something to offer.
  const shown = rows.length - group.calls.length;
  const hidden = { lines: printed.lines - shown, errors: logFloor === "off" ? printed.errors : 0 };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      setWindow({ top: element.scrollTop, height: element.clientHeight });
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= TAIL_SLACK;
      // Written now, not on the render this schedules: the next row may land before that
      // render does, and it must not scroll the log back down.
      if (atBottom !== tailingRef.current) onTailingRef.current(atBottom);
    };

    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [tailingRef]);

  // Following means staying at the bottom as rows arrive.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && tailingRef.current) element.scrollTop = element.scrollHeight;
  }, [total, tailing, tailingRef]);

  const first = Math.max(0, Math.floor(window.top / CALL_ROW_HEIGHT) - OVERSCAN);
  const count = Math.max(0, Math.min(total - first, Math.ceil(window.height / CALL_ROW_HEIGHT) + OVERSCAN * 2));
  const visible = rows.slice(first, first + count);
  // The log is never collapsed or summarised away, so this says what is out of sight
  // rather than standing in for it.
  const rowsBelow = Math.max(0, total - Math.round((window.top + window.height) / CALL_ROW_HEIGHT));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} data-testid="console-log" className="@container shrink overflow-y-auto" style={{ maxHeight: MAX_LOG_HEIGHT }}>
        {total === 0 ? (
          <div className="flex h-[24px] items-center px-3 text-xs text-muted-foreground">
            {/* A run parked on a question is in flight but is not on its way to
                a call — the tail bar below already says what it is doing. */}
            {group.running && !waiting ? "Waiting for the first call…" : "No calls."}
          </div>
        ) : (
          <div style={{ height: total * CALL_ROW_HEIGHT }}>
            <div style={{ transform: `translateY(${first * CALL_ROW_HEIGHT}px)` }}>
              {visible.map((item) =>
                item.call ? (
                  <RunLog.CallRow
                    key={item.id}
                    id={item.id}
                    name={callLabel(item.call)}
                    timestamp={item.timestamp}
                    loopKey={item.key}
                    status={itemStatus(item)}
                    durationMs={callDurationMs(item.call)}
                    errorCode={callErrorCode(item.call)}
                    fraction={barFraction(callDurationMs(item.call), slowest)}
                    selected={item.id === selectedItemId}
                    stale={group.run.stale === true}
                    onSelect={onSelectRow}
                    now={now}
                  />
                ) : (
                  <RunLog.LogRow
                    key={item.id}
                    id={item.id}
                    timestamp={item.timestamp}
                    level={printedLevel(item)}
                    message={item.logs?.[0]?.message ?? ""}
                    selected={item.id === selectedItemId}
                    stale={group.run.stale === true}
                    onSelect={onSelectRow}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>

      <RunLog.TailBar
        waiting={waiting}
        scriptFailed={scriptFailed}
        running={group.running && !waiting}
        calls={group.calls.length}
        elapsedMs={now - group.run.startedAt}
        rowsBelow={rowsBelow}
        failures={failures}
        dropped={group.dropped}
        hiddenLines={hidden.lines}
        hiddenErrors={hidden.errors}
        tailing={tailing}
        onFollow={() => onTailingChange(true)}
        onShowLogs={onShowLogs}
        onGoToCanvas={onGoToCanvas}
      />

      {/* The payload sits in a pane of its own that never reflows as you move
          through the log — which is why Request/Response/Headers live down here
          rather than in the header. */}
      <div className={cn("flex min-h-0 flex-1 flex-col border-t border-border", group.run.stale && "opacity-70")}>
        {group.run.payloadsExpired ? (
          <RunLog.NoPayload>Response no longer kept — run to see it live</RunLog.NoPayload>
        ) : selectedItem?.payloadsDropped ? (
          <RunLog.NoPayload>Payload let go to keep this run bounded — run to see it live</RunLog.NoPayload>
        ) : selectedItem?.call ? (
          <RunLog.PayloadPane methodCall={selectedItem.call} activeTab={activeTab} onTabChange={onTabChange} />
        ) : selectedItem?.printed ? (
          <RunLog.PrintedPane message={selectedItem.logs?.[0]?.message ?? ""} level={printedLevel(selectedItem)} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
            {/* With logs mixed in, a row is not necessarily a call — and this
                pane is what a printed line's full text opens into. */}
            {total === 0 ? "Nothing to show." : logFloor === "off" ? "Select a call." : "Select a row."}
          </div>
        )}
      </div>
    </div>
  );
}

// A payload that is not there any more, and why. Expiry is only bearable when it is
// a stated state rather than a silent hole.
RunLog.NoPayload = function ({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <span className="text-xs text-muted-foreground">{children}</span>
      <span className="font-mono text-xs text-muted-foreground">{runShortcutLabel}</span>
    </div>
  );
};

interface LogRowProps {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  selected: boolean;
  stale: boolean;
  onSelect: (itemId: string) => void;
}

/**
 * One line the script printed, mixed into the calls where it was printed. The same
 * fixed 24px as a call row, truncating rather than wrapping — the windowing is
 * arithmetic only because every row is that height. The full line is one click away
 * in the pane below.
 */
RunLog.LogRow = memo(function LogRow({ id, timestamp, level, message, selected, stale, onSelect }: LogRowProps) {
  return (
    <div
      data-testid="console-log-row"
      className={cn("flex shrink-0 cursor-pointer items-center gap-2.5 px-3", selected ? "bg-accent" : "hover:bg-accent/50", stale && "opacity-75")}
      style={{ height: CALL_ROW_HEIGHT }}
      onClick={() => onSelect(id)}
    >
      {/* A printed line is a channel rather than a verdict, so it takes a bar in
          the status slot instead of a dot: it is deliberately not one of the
          things the run's dot is the worst of. */}
      <span className={cn("h-[9px] w-[2px] shrink-0 rounded-full", logLevelClass(level))} />
      <span className="w-[8ch] shrink-0 font-mono text-xs tabular-nums text-muted-foreground @max-[360px]:hidden">{formatClockTime(timestamp)}</span>
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", level >= LogLevel.LEVEL_WARN ? logLevelTextClass(level) : "text-muted-foreground/80")}>
        {message}
      </span>
    </div>
  );
});

// The full text of a printed line, which is why the row above it may truncate.
RunLog.PrintedPane = function ({ message, level }: { message: string; level: LogLevel }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-border px-3">
        <span className={cn("h-[9px] w-[2px] shrink-0 rounded-full", logLevelClass(level))} />
        <span className="text-xs text-muted-foreground">{logLevelLabel(level)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <pre className={cn("whitespace-pre-wrap break-words font-mono text-xs", level >= LogLevel.LEVEL_WARN ? logLevelTextClass(level) : "text-foreground")}>
          {message}
        </pre>
      </div>
    </div>
  );
};

function logLevelClass(level: LogLevel): string {
  if (level === LogLevel.LEVEL_ERROR) return "bg-destructive";
  if (level === LogLevel.LEVEL_WARN) return "bg-amber-500";
  return "bg-muted-foreground/40";
}

function logLevelTextClass(level: LogLevel): string {
  if (level === LogLevel.LEVEL_ERROR) return "text-destructive";
  if (level === LogLevel.LEVEL_WARN) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function logLevelLabel(level: LogLevel): string {
  if (level === LogLevel.LEVEL_ERROR) return "console.error";
  if (level === LogLevel.LEVEL_WARN) return "console.warn";
  if (level === LogLevel.LEVEL_DEBUG) return "console.debug";
  return "console.log";
}

interface TailBarProps {
  waiting: boolean;
  scriptFailed: boolean;
  // The one state here that is about the run rather than about what the log is
  // leaving out.
  running: boolean;
  calls: number;
  elapsedMs: number;
  rowsBelow: number;
  failures: number;
  // The log says where it stops being complete rather than quietly ending there.
  dropped: number;
  // Left out of the list is not the same as never happened, and a clean list over a
  // run that printed an error is the one thing this refuses to be.
  hiddenLines: number;
  hiddenErrors: number;
  tailing: boolean;
  onFollow: () => void;
  onShowLogs: () => void;
  onGoToCanvas: () => void;
}

/**
 * What the log can't say inside a row. A run parked on a question, or one whose script
 * threw, is a fact about the whole run, and the log stays readable while it waits.
 */
RunLog.TailBar = function ({
  waiting,
  scriptFailed,
  running,
  calls,
  elapsedMs,
  rowsBelow,
  failures,
  dropped,
  hiddenLines,
  hiddenErrors,
  tailing,
  onFollow,
  onShowLogs,
  onGoToCanvas,
}: TailBarProps) {
  if (!waiting && !scriptFailed && !running && rowsBelow <= 0 && failures === 0 && dropped === 0 && hiddenLines === 0 && tailing) return null;

  const state = waiting ? "waiting" : scriptFailed ? "failed" : running ? "running" : "counts";

  return (
    <div
      data-testid="console-tail"
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-2 border-t px-3 font-mono text-xs",
        state === "waiting" && "border-l-2 border-l-amber-500 border-t-border bg-amber-500/10",
        state === "failed" && "border-l-2 border-l-destructive border-t-border bg-destructive/10",
        (state === "running" || state === "counts") && "border-t-border",
      )}
    >
      {state === "waiting" && (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">Waiting for an answer</span>
        </>
      )}
      {state === "failed" && <span className="text-destructive">Script failed</span>}
      {/* The one place the mark is the running indicator. The row exists only
          while the run does, so nothing here is aligned to a glyph that is about
          to change width. */}
      {state === "running" && (
        <>
          <KajaTrace running />
          <span className="text-muted-foreground">
            {calls === 1 ? "1 call" : `${calls} calls`} · {formatElapsed(elapsedMs)}
          </span>
        </>
      )}
      {(state === "running" || state === "counts") && rowsBelow > 0 && <span className="text-muted-foreground">{rowsBelow} more</span>}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {hiddenLines > 0 && (
          <button
            type="button"
            data-testid="console-show-logs"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onShowLogs}
            title="Mix what the script printed into the calls"
          >
            {/* A dot rather than a second "errors" — the failed-call count sits a
                few pixels to the right and the two must not read as one number. */}
            {hiddenErrors > 0 && <span className="h-1.5 w-1.5 rounded-full bg-destructive" />}
            {hiddenLines === 1 ? "1 log line" : `${hiddenLines} log lines`}
          </button>
        )}
        {dropped > 0 && <span className="text-muted-foreground">{dropped} not kept</span>}
        {failures > 0 && <span className="text-amber-600 dark:text-amber-400">{failures === 1 ? "1 error" : `${failures} errors`}</span>}
        {!tailing && (
          <button
            type="button"
            data-testid="console-follow"
            className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onFollow}
          >
            <ArrowDown size={11} />
            Latest
          </button>
        )}
        {(state === "waiting" || state === "failed") && (
          <button
            type="button"
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              state === "waiting" ? "border-amber-500 text-amber-600 dark:text-amber-400" : "border-destructive text-destructive",
            )}
            onClick={onGoToCanvas}
          >
            Go to canvas
          </button>
        )}
      </div>
    </div>
  );
};

interface CallRowProps {
  id: string;
  name: string;
  timestamp: number;
  loopKey?: string;
  status: RunStatus;
  durationMs?: number;
  errorCode?: string;
  fraction?: number;
  selected: boolean;
  stale: boolean;
  onSelect: (itemId: string) => void;
  now: number;
}

/**
 * One call, and the same shape for every one of them.
 *
 * Every prop is a value rather than an object, which is what makes the memo hold: a
 * settled row is handed the same twelve values on every repaint and doesn't render
 * again. `now` is the exception and is passed as zero unless the row is counting up.
 */
RunLog.CallRow = memo(function CallRow({
  id,
  name,
  timestamp,
  loopKey,
  status,
  durationMs,
  errorCode,
  fraction,
  selected,
  stale,
  onSelect,
  now,
}: CallRowProps) {
  const pending = status === "pending" || status === "streaming";

  return (
    <div
      data-testid="console-call-row"
      className={cn("flex shrink-0 cursor-pointer items-center gap-2.5 px-3", selected ? "bg-accent" : "hover:bg-accent/50", stale && "opacity-75")}
      style={{ height: CALL_ROW_HEIGHT }}
      onClick={() => onSelect(id)}
    >
      {pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(status))} />}
      <span className="w-[8ch] shrink-0 font-mono text-xs tabular-nums text-muted-foreground @max-[360px]:hidden">{formatClockTime(timestamp)}</span>
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", selected ? "text-foreground" : "text-muted-foreground")}>{name}</span>
      {loopKey && <span className="shrink-0 truncate font-mono text-xs text-muted-foreground/80 @max-[440px]:hidden">{loopKey}</span>}
      {errorCode && <span className="shrink-0 font-mono text-xs text-destructive">{errorCode}</span>}
      {fraction !== undefined && (
        <span className="shrink-0 @max-[500px]:hidden" style={{ width: BAR_WIDTH }} aria-hidden>
          <span
            className={cn("block h-[6px] rounded-sm", status === "error" ? "bg-destructive/40" : "bg-muted-foreground/30")}
            style={{ width: `${fraction * 100}%` }}
          />
        </span>
      )}
      <span className={DURATION_COLUMN_CLASS}>{pending ? formatElapsed(now - timestamp) : formatDuration(durationMs)}</span>
    </div>
  );
});

interface PayloadPaneProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

RunLog.PayloadPane = function ({ methodCall, activeTab, onTabChange }: PayloadPaneProps) {
  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);
  const [copied, setCopied] = useState(false);
  const isStreaming = methodCall.streamOutputs !== undefined;
  const hasResponse = methodCall.output !== undefined || methodCall.error !== undefined || (isStreaming && methodCall.streamOutputs!.length > 0);
  const hasError = methodCall.error !== undefined;
  // Fold, unfold and copy act on the JSON viewer, so they exist exactly when it
  // does — not over the headers table, not while a response is still coming.
  const showsJson = activeTab !== "headers" && !(activeTab === "response" && !hasResponse);
  // A fetch carries the verb it was written with; a call kaja carried states its
  // request line beside the headers it went out with instead.
  const requestLine = methodCall.http ? fetchRequestLine(methodCall.http.method, methodCall.http.url) : undefined;

  const copy = async () => {
    if (!(await jsonViewerRef.current?.copyToClipboard())) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Switch to the response tab when the response arrives.
  useEffect(() => {
    if (hasResponse && activeTab === "request") {
      onTabChange("response");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResponse]);

  let content;
  let rawText: string | undefined;
  if (activeTab === "request") {
    content = methodCall.input;
  } else if (hasError) {
    // Same rule as the response below: an HTTP failure arrives wrapped in what carried
    // it here, and the body the API sent is the failure.
    content = unwrapFailure(methodCall.error);
  } else if (isStreaming) {
    rawText = methodCall.streamOutputs!.map((msg) => JSON.stringify(unwrapEnvelope(methodCall.outputType, msg), null, 2)).join("\n\n");
  } else {
    // An app that carries HTTP inside gRPC has to put a body protobuf has no shape for —
    // an array, a scalar — in a field of its own. That field is the encoding, not the
    // response, so the response is what it holds.
    content = unwrapEnvelope(methodCall.outputType, methodCall.output);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The pane names itself: which part of the call on the left, and what
          came back of it on the right. Without the readout a successful call and
          an empty one look the same. */}
      <div className="flex h-[28px] shrink-0 items-center gap-4 overflow-hidden px-3">
        <RunLog.PayloadTabs methodCall={methodCall} activeTab={activeTab} onTabChange={onTabChange} />
        {activeTab !== "headers" && <RunLog.ResponseSummary methodCall={methodCall} content={content} rawText={rawText} />}
        {showsJson && (
          <div className="flex shrink-0 items-center gap-1">
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
            <IconButton icon={copied ? Check : Copy} aria-label="Copy JSON" variant="ghost" size="sm" className={utilityButtonClass} onClick={copy} />
          </div>
        )}
      </div>
      {activeTab === "headers" ? (
        <RunLog.HeadersContent methodCall={methodCall} />
      ) : activeTab === "response" && !hasResponse ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Waiting for a response…</div>
      ) : (
        <>
          {activeTab === "response" && hasError && requestLine && (
            <div className="border-y border-border bg-destructive/10 px-4 py-1.5 font-mono text-xs text-destructive">{requestLine}</div>
          )}
          <JsonViewer ref={jsonViewerRef} value={content} rawText={rawText} />
        </>
      )}
    </div>
  );
};

interface PayloadTabsProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

RunLog.PayloadTabs = function ({ methodCall, activeTab, onTabChange }: PayloadTabsProps) {
  const isStreaming = methodCall.streamOutputs !== undefined;
  const streamCount = isStreaming ? methodCall.streamOutputs!.length : 0;

  const tab = (id: ConsoleTab, label: string) => (
    <span className={cn(payloadTabClass, activeTab === id && payloadTabActiveClass)} onClick={() => onTabChange(id)}>
      {label}
    </span>
  );

  return (
    <div className="flex shrink-0 items-center gap-4">
      {tab("request", "Request")}
      {tab("response", `Response${isStreaming && streamCount > 0 ? ` (${streamCount})` : ""}`)}
      {tab("headers", "Headers")}
    </div>
  );
};

interface ResponseSummaryProps {
  methodCall: MethodCall;
  content: unknown;
  rawText?: string;
}

// Status colour appears here and in the call's dot, and nowhere else.
RunLog.ResponseSummary = function ({ methodCall, content, rawText }: ResponseSummaryProps) {
  const status = callStatus(methodCall);
  const label = { pending: "Pending", streaming: "Streaming", success: "OK", error: callErrorCode(methodCall) ?? "Error" }[status];
  const duration = formatDuration(callDurationMs(methodCall));
  // The stated time is the API's once Kaja measured it; the round trip stays a
  // hover away, and the Headers view states the two hops apart.
  const durationTitle =
    methodCall.upstreamDurationMs !== undefined && methodCall.durationMs !== undefined
      ? `API ${formatDuration(methodCall.upstreamDurationMs)} · end to end ${formatDuration(methodCall.durationMs)}`
      : undefined;
  const size = formatBytes(payloadBytes(content, rawText));
  const streamCount = methodCall.streamOutputs?.length;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap font-mono text-xs">
      <span data-testid="console-status" className={cn("shrink-0 font-medium", statusClass(status))}>
        {label}
      </span>
      {duration && (
        <span title={durationTitle} className="shrink-0 tabular-nums text-muted-foreground @max-[430px]:hidden">
          {duration}
        </span>
      )}
      {size && <span className="shrink-0 tabular-nums text-muted-foreground @max-[500px]:hidden">{size}</span>}
      {streamCount !== undefined && (
        <span className="shrink-0 text-muted-foreground @max-[560px]:hidden">
          {streamCount} {streamCount === 1 ? "message" : "messages"}
        </span>
      )}
    </div>
  );
};

interface HeadersContentProps {
  methodCall: MethodCall;
}

RunLog.HeadersContent = function ({ methodCall }: HeadersContentProps) {
  // One panel, and it is always the API's own headers: where Kaja carried the call it
  // reports what it exchanged upstream, and where the browser called the API directly
  // the transport headers are that exchange. The hop between the browser and Kaja is
  // never what a call is being read for.
  const upstreamRequestHeaders = methodCall.upstreamRequestHeaders || {};
  const upstreamResponseHeaders = methodCall.upstreamResponseHeaders || {};
  // The request line of the upstream call, which a failure reports and the response no
  // longer carries — so a call that succeeded reports none. A fetch states its own
  // either way: the browser made that call, so nothing else records which one it was.
  const upstreamRequest = methodCall.http ? fetchRequestLine(methodCall.http.method, methodCall.http.url) : upstreamRequestLine(methodCall.error);
  // A fetch is the direct case by construction — nothing carried it, so the transport's
  // headers below are the API's own.
  const hasUpstream =
    methodCall.http === undefined &&
    (upstreamRequest !== undefined || Object.keys(upstreamRequestHeaders).length > 0 || Object.keys(upstreamResponseHeaders).length > 0);
  const requestHeaders = hasUpstream ? upstreamRequestHeaders : methodCall.requestHeaders || {};
  const responseHeaders = hasUpstream ? upstreamResponseHeaders : methodCall.responseHeaders || {};

  const section = (title: string, headers: { [key: string]: string }) => (
    <div className="mb-6">
      <div className="mb-2 font-semibold text-foreground">{title}</div>
      {Object.keys(headers).length > 0 ? (
        <RunLog.HeadersTable headers={headers} />
      ) : (
        <div className="italic text-muted-foreground">No {title.toLowerCase()}</div>
      )}
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
      {upstreamRequest && <div className="mb-4 break-all text-foreground">{upstreamRequest}</div>}
      {section("Request headers", requestHeaders)}
      {section("Response headers", responseHeaders)}
    </div>
  );
};

interface HeadersTableProps {
  headers: { [key: string]: string };
}

RunLog.HeadersTable = function ({ headers }: HeadersTableProps) {
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
