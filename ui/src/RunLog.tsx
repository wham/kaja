import { ArrowDown, Check, Copy, FoldVertical, UnfoldVertical } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { barFraction, callErrorCode, dotClass, exchangeStatus, formatBytes, formatDuration, payloadBytes, statusClass, StatusTone } from "./callFormat";
import { formatClockTime, formatElapsed } from "./callTime";
import { cn } from "./cn";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { fetchRequestLine } from "./fetchCall";
import { splitRequestLine } from "./requestLine";
import { unwrapEnvelope } from "./httpEnvelope";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { KajaTrace } from "./KajaTrace";
import { callDurationMs, callLabel, MethodCall } from "./kaja";
import { ArchivedPayload, readArchivedPayload } from "./payloadArchive";
import { callStatus, ConsoleItem, ConsoleTab, itemStatus, LogFloor, printedLevel, RunGroup, RunStatus } from "./runs";
import { useShortcutLabel } from "./shortcuts";
import { LogLevel } from "./server/api";
import { copyText } from "./clipboard";
import { unwrapFailure, upstreamRequestLine } from "./upstream";

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
        held={group.heldCalls}
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
          <RunLog.NoPayload>Response no longer kept. Run to see it live</RunLog.NoPayload>
        ) : selectedItem?.payloadsDropped && selectedItem.call ? (
          <RunLog.ShelvedPayloadPane key={selectedItem.id} item={selectedItem} activeTab={activeTab} onTabChange={onTabChange} />
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

/**
 * A row whose payload left the heap. It is on the shelf rather than gone, so the pane
 * asks for it back and draws the same pane it would have drawn — the reach of the log
 * is what the disk holds, and only the working set is what React does.
 */
RunLog.ShelvedPayloadPane = function ({ item, activeTab, onTabChange }: { item: ConsoleItem; activeTab: ConsoleTab; onTabChange: (tab: ConsoleTab) => void }) {
  // Null once the shelf has answered with nothing, which is a payload old enough to
  // have been let go of there too.
  const [payload, setPayload] = useState<ArchivedPayload | null | undefined>(undefined);
  const ref = item.archivedPayload;

  useEffect(() => {
    if (ref === undefined) {
      setPayload(null);
      return;
    }
    let live = true;
    setPayload(undefined);
    void readArchivedPayload(ref).then((found) => {
      if (live) setPayload(found ?? null);
    });
    return () => {
      live = false;
    };
  }, [ref]);

  if (payload === null) return <RunLog.NoPayload>Payload no longer kept. Run to see it live</RunLog.NoPayload>;
  // A read off the shelf lands within a frame or two, so the wait says nothing rather
  // than flashing a state nobody has time to read.
  if (payload === undefined) return <div className="min-h-0 flex-1" />;
  return <RunLog.PayloadPane methodCall={{ ...item.call!, ...payload }} activeTab={activeTab} onTabChange={onTabChange} />;
};

// A payload that is not there any more, and why. Expiry is only bearable when it is
// a stated state rather than a silent hole.
RunLog.NoPayload = function ({ children }: { children: React.ReactNode }) {
  const runLabel = useShortcutLabel("run");
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <span className="text-xs text-muted-foreground">{children}</span>
      <span className="font-mono text-xs text-muted-foreground">{runLabel}</span>
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
  // Calls waiting on a budget. They are not rows yet, so the count of rows above says
  // nothing about them and the clock below looks like it is moving for nothing.
  held: number;
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
  held,
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
          {held > 0 && <span className="text-amber-600 dark:text-amber-400">{held === 1 ? "1 call held" : `${held} calls held`}</span>}
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

// Whether anything has come back. A stream sets `output` on every message, so the
// list is what says a streaming call has answered.
function hasResponse(methodCall: MethodCall): boolean {
  if (methodCall.output !== undefined || methodCall.error !== undefined) return true;
  return methodCall.streamOutputs !== undefined && methodCall.streamOutputs.length > 0;
}

/**
 * What the response is shown as, which is what its size is measured from: an HTTP
 * failure is the body the API sent, a stream is its messages one after another, and
 * anything else is the message with whatever encoding carried it taken off.
 */
function responsePayload(methodCall: MethodCall): { content?: unknown; rawText?: string } {
  if (methodCall.error !== undefined) return { content: unwrapFailure(methodCall.error) };
  if (methodCall.streamOutputs !== undefined) {
    return { rawText: methodCall.streamOutputs.map((message) => JSON.stringify(unwrapEnvelope(methodCall.outputType, message), null, 2)).join("\n\n") };
  }
  return { content: unwrapEnvelope(methodCall.outputType, methodCall.output) };
}

RunLog.PayloadPane = function ({ methodCall, activeTab, onTabChange }: PayloadPaneProps) {
  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);
  const [copied, setCopied] = useState(false);
  const isStreaming = methodCall.streamOutputs !== undefined;
  const answered = hasResponse(methodCall);
  const hasError = methodCall.error !== undefined;
  // Fold, unfold and copy act on the JSON viewer, so they exist exactly when it
  // does — not over the headers table, not while a response is still coming.
  const showsJson = activeTab !== "headers" && !(activeTab === "response" && !answered);
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
    if (answered && activeTab === "request") {
      onTabChange("response");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered]);

  const { content, rawText } = activeTab === "request" ? { content: methodCall.input, rawText: undefined } : responsePayload(methodCall);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The pane names itself: which part of the call on the left, and what
          came back of it on the right. Without the readout a successful call and
          an empty one look the same. */}
      <div className="flex h-[28px] shrink-0 items-center gap-4 overflow-hidden px-3">
        <RunLog.PayloadTabs methodCall={methodCall} activeTab={activeTab} onTabChange={onTabChange} />
        {activeTab !== "headers" && <RunLog.ResponseSummary methodCall={methodCall} content={content} rawText={rawText} sizeOnly={activeTab === "request"} />}
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
      ) : activeTab === "response" && !answered ? (
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
  // The strip describes the pane in front of you, and the row above already states
  // what happened: on the request there is no status and no duration to have, so the
  // size of what was sent is the whole of what only this pane knows.
  sizeOnly?: boolean;
}

// Status colour appears here and in the call's dot, and nowhere else.
RunLog.ResponseSummary = function ({ methodCall, content, rawText, sizeOnly }: ResponseSummaryProps) {
  const status = callStatus(methodCall);
  const label = { pending: "Pending", streaming: "Streaming", success: "OK", error: callErrorCode(methodCall) ?? "Error" }[status];
  const duration = formatDuration(callDurationMs(methodCall));
  // The stated time is the API's once Kaja measured it; the round trip stays a
  // hover away.
  const durationTitle =
    methodCall.upstreamDurationMs !== undefined && methodCall.durationMs !== undefined
      ? `API ${formatDuration(methodCall.upstreamDurationMs)} · end to end ${formatDuration(methodCall.durationMs)}`
      : undefined;
  const size = formatBytes(payloadBytes(content, rawText));
  const streamCount = methodCall.streamOutputs?.length;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap font-mono text-xs">
      {!sizeOnly && (
        <span data-testid="console-status" className={cn("shrink-0 font-medium", statusClass(status))}>
          {label}
        </span>
      )}
      {!sizeOnly && duration && (
        <span title={durationTitle} className="shrink-0 tabular-nums text-muted-foreground @max-[430px]:hidden">
          {duration}
        </span>
      )}
      {size && <span className="shrink-0 tabular-nums text-muted-foreground @max-[500px]:hidden">{size}</span>}
      {!sizeOnly && streamCount !== undefined && (
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

// The column the key and the verb are set against: enough for "GET" and the two
// spaces after it, which is what a wrapped request line hangs to.
const HANGING_INDENT = 30;

RunLog.HeadersContent = function ({ methodCall }: HeadersContentProps) {
  // One panel, and it is always the API's own headers: where Kaja carried the call it
  // reports what it exchanged upstream, and where the browser called the API directly
  // the transport headers are that exchange. The hop between the browser and Kaja is
  // never what a call is being read for.
  const upstreamRequestHeaders = methodCall.upstreamRequestHeaders || {};
  const upstreamResponseHeaders = methodCall.upstreamResponseHeaders || {};
  // The request line of the upstream call. A call reports its own; a failure from
  // before that was recorded still carries one, which is what the fallback reads.
  // A fetch states its own either way: the browser made that call, so nothing else
  // records which one it was.
  const requestLine = methodCall.requestLine ?? upstreamRequestLine(methodCall.error);
  // A fetch is the direct case by construction — nothing carried it, so the transport's
  // headers below are the API's own.
  const hasUpstream =
    methodCall.http === undefined &&
    (requestLine !== undefined || Object.keys(upstreamRequestHeaders).length > 0 || Object.keys(upstreamResponseHeaders).length > 0);
  const requestHeaders = hasUpstream ? upstreamRequestHeaders : methodCall.requestHeaders || {};
  const responseHeaders = hasUpstream ? upstreamResponseHeaders : methodCall.responseHeaders || {};
  const { content, rawText } = responsePayload(methodCall);
  const answered = hasResponse(methodCall);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs">
      <div className="grid" style={{ gridTemplateColumns: "max-content minmax(0,1fr)", columnGap: 28, rowGap: 3 }}>
        <RunLog.HeaderGroupBar label="Request" headers={requestHeaders} size={payloadBytes(methodCall.input)} />
        {requestLine && <RunLog.RequestLine line={requestLine} />}
        <RunLog.HeaderRows headers={requestHeaders} />
        <RunLog.HeaderGroupBar
          label="Response"
          headers={responseHeaders}
          status={exchangeStatus(methodCall)}
          durationMs={callDurationMs(methodCall)}
          size={answered ? payloadBytes(content, rawText) : undefined}
          pending={!answered}
          className="mt-4"
        />
        {/* A call with no response yet keeps its bar and nothing under it: the half
            exists, and a placeholder would be stating something nobody sent. */}
        {answered && <RunLog.HeaderRows headers={responseHeaders} />}
      </div>
    </div>
  );
};

const statusToneClass: { [tone in StatusTone]: string } = {
  success: "border-emerald-600/40 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400/40 dark:text-emerald-400",
  redirect: "border-border bg-muted text-muted-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

interface HeaderGroupBarProps {
  label: string;
  headers: { [key: string]: string };
  status?: { code: string; reason?: string; tone: StatusTone };
  durationMs?: number;
  size?: number;
  pending?: boolean;
  className?: string;
}

/**
 * The rule above one half of the exchange, carrying what belongs to that half and
 * nothing the call row above already states: the status the response came with, the
 * time it took, the bytes each way, and the copy that takes this half alone.
 */
RunLog.HeaderGroupBar = function ({ label, headers, status, durationMs, size, pending, className }: HeaderGroupBarProps) {
  const [copied, setCopied] = useState(false);
  const names = Object.keys(headers);

  const copy = async () => {
    if (!(await copyText(names.map((name) => `${name}: ${headers[name]}`).join("\n")))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={cn("mb-1.5 flex items-center gap-2.5", className)} style={{ gridColumn: "1/-1" }}>
      <span className="shrink-0 text-[11px] uppercase tracking-[0.07em] text-muted-foreground">{label}</span>
      {status && (
        <span className={cn("flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-[11px]", statusToneClass[status.tone])}>
          <span className="font-medium">{status.code}</span>
          {status.reason && <span>{status.reason}</span>}
        </span>
      )}
      {pending && <span role="img" aria-label="Waiting for a response" className={cn("size-1.5 shrink-0 rounded-full", dotClass("pending"))} />}
      <span className="h-px min-w-4 flex-1 bg-border" />
      {durationMs !== undefined && <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatDuration(durationMs)}</span>}
      {size !== undefined && <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatBytes(size)}</span>}
      {names.length > 0 && (
        <IconButton
          icon={copied ? Check : Copy}
          aria-label={`Copy ${label.toLowerCase()} headers`}
          variant="ghost"
          size="xs"
          className="size-5 shrink-0 hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
          onClick={copy}
        />
      )}
    </div>
  );
};

/**
 * The call, with the origin and the query behind the verb and the path. Those two are
 * what identify it; the rest is context, and dimming it is what lets the path be found
 * in a line that wraps over three of them.
 */
RunLog.RequestLine = function ({ line }: { line: string }) {
  const { method, origin, path, query } = splitRequestLine(line);

  return (
    <div className="mb-1.5 break-all" style={{ gridColumn: "1/-1", textIndent: -HANGING_INDENT, paddingLeft: HANGING_INDENT }}>
      {method && <span className="font-medium text-foreground">{method}&nbsp;&nbsp;</span>}
      {origin && <span className="text-muted-foreground">{origin}</span>}
      <span className="text-foreground">{path}</span>
      {query && <span className="text-muted-foreground">{query}</span>}
    </div>
  );
};

/**
 * One row per header, names as the server sent them and in the order they arrived:
 * the log's job is to be complete, and reordering is editorialising. Both halves are
 * cells of the one grid, so a value starts at the same x wherever it is read.
 */
RunLog.HeaderRows = function ({ headers }: { headers: { [key: string]: string } }) {
  return (
    <>
      {Object.keys(headers).map((name) => (
        <RunLog.HeaderRow key={name} name={name} value={headers[name]} />
      ))}
    </>
  );
};

RunLog.HeaderRow = function ({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await copyText(value))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // `contents` rather than a row of its own: the two cells belong to the pane's one
  // grid, and only their wrapper can carry the hover the copy is revealed by.
  return (
    <div className="group contents">
      <span className="text-muted-foreground">{name}</span>
      <span className="relative break-all text-foreground">
        {value}
        <IconButton
          icon={copied ? Check : Copy}
          aria-label={`Copy ${name}`}
          variant="ghost"
          size="xs"
          tooltip="native"
          className="absolute -top-px right-0 size-5 bg-background opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3.5"
          onClick={copy}
        />
      </span>
    </div>
  );
};
