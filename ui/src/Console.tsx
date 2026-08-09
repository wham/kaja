import { ArrowDown, Bot, Check, ChevronDown, ChevronsUpDown, ChevronUp, Copy, FoldVertical, Trash2, UnfoldVertical } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApproveGesture, blockText } from "./blocks";
import { barFraction, callErrorCode, dotClass, formatBytes, formatDuration, payloadBytes, statusClass } from "./callFormat";
import { formatClockTime, formatDayLabel, formatElapsed, isSameDay } from "./callTime";
import { Canvas } from "./Canvas";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { SegmentedControl } from "./components/segmented-control";
import { Spinner } from "./components/spinner";
import { consoles } from "./consoles";
import { unwrapEnvelope } from "./httpEnvelope";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { MethodCall } from "./kaja";
import { ConsoleItem, ConsoleTab, ConsoleView, defaultView, followSelection, itemStatus, RunGroup, RunSelection, RunStatus } from "./runs";
import { runShortcutLabel } from "./RunButton";
import { TableView } from "./tableView";
import { LogLevel } from "./server/api";
import { unwrapFailure, upstreamRequestLine } from "./upstreamHeaders";

export type { ConsoleItem } from "./runs";

// The dropdown is a fixed 420px and scrolls after eight rows, so a long session
// never turns the console header into a full-height surface.
const RUN_ROW_HEIGHT = 32;
const MAX_VISIBLE_RUN_ROWS = 8;
// The log's rows are a fixed height, which is what makes windowing it arithmetic
// rather than measurement: the row that belongs at a scroll position is a
// division, and the ones above and below it are two spacers.
const CALL_ROW_HEIGHT = 24;
// Rows drawn beyond the viewport, so a flick of the wheel doesn't show a gap.
const OVERSCAN = 8;
// How close to the bottom still counts as being at the bottom. A run appends
// while you read, so this is a couple of rows rather than nothing.
const TAIL_SLACK = CALL_ROW_HEIGHT * 2;
// How much of the console the log may take before the payload pane stops
// shrinking. The pane is the thing being read; the log is how you choose it.
const MAX_LOG_HEIGHT = "45%";
// The widest a duration bar is drawn, in pixels.
const BAR_WIDTH = 88;

const consoleTabClass = "cursor-pointer select-none whitespace-nowrap text-xs text-muted-foreground hover:text-foreground";
const consoleTabActiveClass = "font-medium text-foreground";
// Utilities carry no resting chrome: they are worth no more weight than the tabs
// beside them.
const utilityButtonClass = "h-6 w-6 rounded-md hover:bg-accent hover:text-foreground";
// Both time columns are reserved: the longest value they can ever hold sets the
// geometry once, so nothing moves as calls settle and age.
const DETAIL_COLUMN_CLASS = "w-[9ch] shrink-0 truncate text-right font-mono text-xs tabular-nums text-muted-foreground";

interface ConsoleProps {
  // Which file's console this is. It is the whole scope: the runs are that
  // file's runs, and changing it swaps consoles rather than reporting a new run.
  fileId?: string;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
  onClear?: () => void;
}

/**
 * A console belongs to a script and holds its runs; a run has two views of the
 * same data. The list is the flat audit log — one row per call, in wall order,
 * always complete. The canvas is the rendered output. One segmented control
 * switches them, and everything else about the header stops moving.
 *
 * What it reads is not React state: a run is a buffer the store appends to, and
 * this is the only thing in the window that subscribes to it. A thousand calls
 * repaint the console, and nothing else.
 */
export function Console({ fileId, onAnswer, onCancelAsk, onDecide, tableViews, onTableView, onTablePull, onClear }: ConsoleProps) {
  useSyncExternalStore(
    useCallback((notify: () => void) => (fileId === undefined ? () => {} : consoles.subscribeFile(fileId, notify)), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );

  const file = consoles.file(fileId);
  const groups = file.groups;
  const selection = file.selection;
  const activeTab = file.tab;
  const newest = groups[groups.length - 1];

  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  /**
   * Whether the log is following the run, like a terminal. It stops the moment
   * you scroll off the bottom and starts again when you come back to it.
   *
   * The ref is the answer and the state is only what redraws the chip. A run
   * appends between two of your wheel events, and anything that read this from a
   * render would still be following on the frame that scrolls the log back down
   * under your hands.
   */
  const tailingRef = useRef(true);
  const [tailing, setTailingState] = useState(true);
  const setTailing = useCallback((next: boolean) => {
    if (tailingRef.current === next) return;
    tailingRef.current = next;
    setTailingState(next);
  }, []);

  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);

  // A settled call shows the wall-clock time it was made, which never changes —
  // so the clock only runs while something is still in flight, counting up in
  // tenths for the call that is.
  const hasInFlight = groups.some((group) => group.inFlight);

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [hasInFlight]);

  const onSelect = useCallback((next: RunSelection | null) => consoles.setSelection(fileId, next, Date.now()), [fileId]);
  const onTabChange = useCallback((tab: ConsoleTab) => consoles.setTab(fileId, tab, Date.now()), [fileId]);
  const onViewChange = useCallback((view: ConsoleView) => consoles.setView(fileId, view, Date.now()), [fileId]);

  // The file and run the console has followed, which is what tells a run
  // arriving apart from a call arriving inside the one already on screen — and
  // both apart from the console being handed a different file altogether.
  const followedRef = useRef<{ fileId?: string; runId?: string }>({});

  useEffect(() => {
    const sameFile = followedRef.current.fileId === fileId;
    const isNewRun = sameFile && followedRef.current.runId !== newest?.run.id;
    const arrived = !sameFile || isNewRun;
    followedRef.current = { fileId, runId: newest?.run.id };
    // Pressing Run is a request to watch what it does, and so is opening another
    // file: either way the log goes back to following.
    if (arrived) setTailing(true);
    // Arriving at another file is not a run arriving: its own selection has just
    // been restored, and only a selection with nothing left to point at is
    // moved on to the newest run.
    const next = followSelection(selection, groups, isNewRun, tailingRef.current);
    if (next?.runId !== selection?.runId || next?.itemId !== selection?.itemId) onSelect(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, file.version, tailing]);

  const selectedGroup = groups.find((group) => group.run.id === selection?.runId);
  const rows = selectedGroup?.calls ?? [];
  const selectedItem = selection?.itemId !== undefined ? rows.find((item) => item.id === selection.itemId) : undefined;
  const selectedCall = selectedItem?.call;
  const activeView = file.view ?? defaultView(selectedGroup);
  const waiting = selectedGroup?.awaiting;

  const selectRun = useCallback(
    (group: RunGroup) => {
      setTailing(true);
      onSelect({ runId: group.run.id, itemId: group.calls[group.calls.length - 1]?.id });
    },
    [onSelect],
  );

  // ⌃↑ / ⌃↓ step through this file's runs without opening the dropdown, which is
  // what makes one go at a call comparable against the last.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (groups.length === 0) return;
      event.preventDefault();
      const index = groups.findIndex((group) => group.run.id === selection?.runId);
      const from = index === -1 ? groups.length - 1 : index;
      const next = Math.max(0, Math.min(groups.length - 1, from + (event.key === "ArrowUp" ? -1 : 1)));
      selectRun(groups[next]);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [groups, selection?.runId, selectRun]);

  const handleCopy = useCallback(() => {
    if (activeView === "canvas") {
      const text = (selectedGroup?.items ?? [])
        .map((item) => (item.block ? blockText(item.block) : item.call ? `${item.call.service.name}.${item.call.method.name}` : ""))
        .filter((line) => line.length > 0)
        .join("\n\n");
      navigator.clipboard?.writeText(text);
    } else {
      jsonViewerRef.current?.copyToClipboard();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [activeView, selectedGroup]);

  // Clicking a call on the canvas is a request for its complete record, which
  // only the log has — so it takes you there rather than unrolling a payload
  // into the flow.
  const selectFromCanvas = useCallback(
    (itemId: string) => {
      if (!selectedGroup) return;
      setTailing(false);
      onViewChange("list");
      onSelect({ runId: selectedGroup.run.id, itemId });
    },
    [selectedGroup, onSelect, onViewChange],
  );

  // Picking a row is a decision to read it, so the log stops moving under it.
  const selectRow = useCallback(
    (itemId: string) => {
      if (!selectedGroup) return;
      setTailing(false);
      onSelect({ runId: selectedGroup.run.id, itemId });
    },
    [selectedGroup, onSelect],
  );

  // With no run there is no selection to show and no views to choose between:
  // a selected Response over an empty panel implies a state the console doesn't
  // have. The empty line is the only thing that should speak.
  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-xs text-muted-foreground">
        Run a script to see its calls here — <span className="ml-1 font-mono">{runShortcutLabel}</span>
      </div>
    );
  }

  const showUtilities = activeView === "canvas" || selectedCall !== undefined;
  const position = selectedGroup ? groups.indexOf(selectedGroup) + 1 : groups.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* One row spanning the full console width, and it holds its shape: which
          run, which view, how to step through them, and what to do with what is
          shown. Nothing here rearranges as the selection moves — that is the
          change the split pays for. Everything leaves in order of what it is
          worth as the panel narrows, and the run pill truncates through all of
          it. */}
      <div className="@container flex h-[35px] shrink-0 items-center gap-3 overflow-hidden border-b border-border px-3">
        <Console.RunSelect groups={groups} selectedGroup={selectedGroup} onSelect={selectRun} onClear={onClear} now={now} />
        <div className="h-4 w-px shrink-0 bg-border" />
        <SegmentedControl className="h-[26px] shrink-0 p-[2px]" aria-label="Run view">
          <SegmentedControl.Button
            selected={activeView === "list"}
            className="h-[20px] px-2.5 py-0 text-xs"
            onClick={() => onViewChange("list")}
            data-testid="console-view-list"
          >
            List
          </SegmentedControl.Button>
          <SegmentedControl.Button
            selected={activeView === "canvas"}
            className="h-[20px] gap-1.5 px-2.5 py-0 text-xs"
            onClick={() => onViewChange("canvas")}
            data-testid="console-view-canvas"
          >
            Canvas
            {/* One of three chances to notice a parked run before you leave the
                script — the others are the tail of the log and the run pill. */}
            {waiting && activeView !== "canvas" && <span data-testid="canvas-badge" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </SegmentedControl.Button>
        </SegmentedControl>
        <div className="flex shrink-0 items-center gap-1 @max-[560px]:hidden">
          <IconButton
            icon={ChevronUp}
            aria-label="Previous run"
            variant="ghost"
            size="sm"
            tooltip={false}
            className="h-6 w-6"
            disabled={position <= 1}
            onClick={() => selectRun(groups[Math.max(0, position - 2)])}
          />
          <IconButton
            icon={ChevronDown}
            aria-label="Next run"
            variant="ghost"
            size="sm"
            tooltip={false}
            className="h-6 w-6"
            disabled={position >= groups.length}
            onClick={() => selectRun(groups[Math.min(groups.length - 1, position)])}
          />
          <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
            {position} of {groups.length}
          </span>
        </div>
        {showUtilities && (
          <div className="ml-auto flex shrink-0 items-center gap-2 @max-[430px]:hidden">
            {activeView === "list" && (
              <>
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
              </>
            )}
            <IconButton
              icon={copied ? Check : Copy}
              aria-label={activeView === "canvas" ? "Copy canvas" : "Copy JSON"}
              variant="ghost"
              size="sm"
              className={utilityButtonClass}
              onClick={handleCopy}
            />
          </div>
        )}
      </div>

      {selectedGroup && activeView === "canvas" ? (
        <Canvas
          group={selectedGroup}
          selectedItemId={selection?.itemId}
          onAnswer={onAnswer}
          onCancelAsk={onCancelAsk}
          onDecide={onDecide}
          onSelectCall={selectFromCanvas}
          tableViews={tableViews}
          onTableView={onTableView}
          onTablePull={onTablePull}
        />
      ) : selectedGroup ? (
        <Console.ListView
          group={selectedGroup}
          rows={rows}
          selectedItemId={selection?.itemId}
          activeTab={activeTab}
          selectedItem={selectedItem}
          waiting={waiting !== undefined}
          jsonViewerRef={jsonViewerRef}
          now={now}
          tailing={tailing}
          tailingRef={tailingRef}
          onTailingChange={setTailing}
          onSelectRow={selectRow}
          onTabChange={onTabChange}
          onGoToCanvas={() => onViewChange("canvas")}
        />
      ) : null}
    </div>
  );
}

interface ListViewProps {
  group: RunGroup;
  rows: ConsoleItem[];
  selectedItemId?: string;
  activeTab: ConsoleTab;
  selectedItem?: ConsoleItem;
  waiting: boolean;
  jsonViewerRef: React.MutableRefObject<JsonViewerHandle | null>;
  now: number;
  tailing: boolean;
  // The same answer, readable without a render — see the note where it is made.
  tailingRef: React.MutableRefObject<boolean>;
  onTailingChange: (tailing: boolean) => void;
  onSelectRow: (itemId: string) => void;
  onTabChange: (tab: ConsoleTab) => void;
  onGoToCanvas: () => void;
}

/**
 * The flat audit log. A row is a call and only a call — no disclosure triangles,
 * no block rows, no run row — which is what keeps it scannable and lets every
 * row carry the same two extra channels.
 *
 * Only the rows on screen are drawn. The rest are two spacers, because a fixed
 * row height means the log's length is a number rather than a measurement — so
 * it stays complete at any length without a thousand rows in the document.
 */
Console.ListView = function ({
  group,
  rows,
  selectedItemId,
  activeTab,
  selectedItem,
  waiting,
  jsonViewerRef,
  now,
  tailing,
  tailingRef,
  onTailingChange,
  onSelectRow,
  onTabChange,
  onGoToCanvas,
}: ListViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ top: 0, height: 0 });
  const onTailingRef = useRef(onTailingChange);
  onTailingRef.current = onTailingChange;

  const total = rows.length;
  const slowest = group.stats.slowest;
  const failures = group.failures;
  const scriptFailed = group.items.some((item) => item.logs?.some((log) => log.level === LogLevel.LEVEL_ERROR));

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => {
      setWindow({ top: element.scrollTop, height: element.clientHeight });
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= TAIL_SLACK;
      // Written now, not on the render this schedules: the next row may land
      // before that render does, and it must not scroll the log back down.
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
  // What is still below the fold. The log is never collapsed or summarised away,
  // so this says what is out of sight rather than standing in for it.
  const rowsBelow = Math.max(0, total - Math.round((window.top + window.height) / CALL_ROW_HEIGHT));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} data-testid="console-log" className="@container shrink overflow-y-auto" style={{ maxHeight: MAX_LOG_HEIGHT }}>
        {total === 0 ? (
          <div className="flex h-[24px] items-center px-3 text-xs text-muted-foreground">
            {/* A run parked on a question is in flight but is not on its way to
                a call — the tail bar below already says what it is doing. */}
            {group.inFlight && !waiting ? "Waiting for the first call…" : "No calls."}
          </div>
        ) : (
          <div style={{ height: total * CALL_ROW_HEIGHT }}>
            <div style={{ transform: `translateY(${first * CALL_ROW_HEIGHT}px)` }}>
              {visible.map((item) => (
                <Console.CallRow
                  key={item.id}
                  id={item.id}
                  name={`${item.call!.service.name}.${item.call!.method.name}`}
                  timestamp={item.timestamp}
                  loopKey={item.key}
                  status={itemStatus(item)}
                  durationMs={item.call!.durationMs}
                  errorCode={callErrorCode(item.call!)}
                  fraction={barFraction(item.call!.durationMs, slowest)}
                  selected={item.id === selectedItemId}
                  stale={group.run.stale === true}
                  onSelect={onSelectRow}
                  now={now}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <Console.TailBar
        waiting={waiting}
        scriptFailed={scriptFailed}
        rowsBelow={rowsBelow}
        failures={failures}
        dropped={group.dropped}
        tailing={tailing}
        onFollow={() => onTailingChange(true)}
        onGoToCanvas={onGoToCanvas}
      />

      {/* The payload sits in a pane of its own that never reflows as you move
          through the log — which is why Request/Response/Headers live down here
          rather than in the header. */}
      <div className={cn("flex min-h-0 flex-1 flex-col border-t border-border", group.run.stale && "opacity-70")}>
        {group.run.payloadsExpired ? (
          <Console.NoPayload>Response no longer kept — run to see it live</Console.NoPayload>
        ) : selectedItem?.payloadsDropped ? (
          <Console.NoPayload>Payload let go to keep this run bounded — run to see it live</Console.NoPayload>
        ) : selectedItem?.call ? (
          <Console.DetailContent methodCall={selectedItem.call} activeTab={activeTab} onTabChange={onTabChange} jsonViewerRef={jsonViewerRef} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
            {total === 0 ? "Nothing to show." : "Select a call."}
          </div>
        )}
      </div>
    </div>
  );
};

// A payload that is not there any more, and why. Expiry is only bearable when it
// is a stated state rather than a silent hole.
Console.NoPayload = function ({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <span className="text-xs text-muted-foreground">{children}</span>
      <span className="font-mono text-xs text-muted-foreground">{runShortcutLabel}</span>
    </div>
  );
};

interface TailBarProps {
  waiting: boolean;
  scriptFailed: boolean;
  rowsBelow: number;
  failures: number;
  // Rows a very long run stopped keeping. The log says where it stops being
  // complete rather than quietly ending there.
  dropped: number;
  tailing: boolean;
  onFollow: () => void;
  onGoToCanvas: () => void;
}

/**
 * What the log can't say inside a row. A run parked on a question, or one whose
 * script threw, is a fact about the whole run, and the log stays readable while
 * it waits — the pause blocks the script, not your reading.
 */
Console.TailBar = function ({ waiting, scriptFailed, rowsBelow, failures, dropped, tailing, onFollow, onGoToCanvas }: TailBarProps) {
  if (!waiting && !scriptFailed && rowsBelow <= 0 && failures === 0 && dropped === 0 && tailing) return null;

  const state = waiting ? "waiting" : scriptFailed ? "failed" : "counts";

  return (
    <div
      data-testid="console-tail"
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-2 border-t px-3 font-mono text-xs",
        state === "waiting" && "border-l-2 border-l-amber-500 border-t-border bg-amber-500/10",
        state === "failed" && "border-l-2 border-l-destructive border-t-border bg-destructive/10",
        state === "counts" && "border-t-border",
      )}
    >
      {state === "waiting" && (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">Waiting for an answer</span>
        </>
      )}
      {state === "failed" && <span className="text-destructive">Script failed</span>}
      {state === "counts" && rowsBelow > 0 && <span className="text-muted-foreground">{rowsBelow} more</span>}
      <div className="ml-auto flex shrink-0 items-center gap-3">
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
 * One call, and the same shape for every one of them: when it happened, what it
 * was, which pass through the loop it belonged to, and how long it took — as a
 * number and as a length.
 *
 * Every prop is a value rather than an object, which is what makes the memo
 * hold: a settled row is handed the same twelve values on every repaint and
 * doesn't render again. `now` is the exception and is passed as zero unless the
 * row is the one counting up.
 */
Console.CallRow = memo(function CallRow({
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
      <span className={DETAIL_COLUMN_CLASS}>{pending ? formatElapsed(now - timestamp) : formatDuration(durationMs)}</span>
    </div>
  );
});

interface RunSelectProps {
  groups: RunGroup[];
  selectedGroup?: RunGroup;
  onSelect: (group: RunGroup) => void;
  onClear?: () => void;
  now: number;
}

/**
 * Run identity stays in the one place it already lives, and the header keeps its
 * shape. The pill inherits the status of the run it names, so a waiting or
 * failed run is legible without opening the menu.
 */
Console.RunSelect = function ({ groups, selectedGroup, onSelect, onClear, now }: RunSelectProps) {
  const [open, setOpen] = useState(false);
  const summary = selectedGroup ? runSummary(selectedGroup, groups, now) : undefined;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="console-call-select"
          className={cn(
            "flex h-[26px] min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 hover:bg-accent",
            summary?.waiting ? "border-amber-500/60" : "border-border",
          )}
          title={summary?.name}
        >
          {summary?.pending && !summary.waiting ? (
            <Spinner className="size-3" />
          ) : (
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", summary?.dotClass)} />
          )}
          <span className="shrink-0 font-mono text-xs text-foreground">{summary?.name}</span>
          {summary?.agent && <Bot size={12} className="shrink-0 text-muted-foreground" aria-label="Run by an agent" />}
          {summary?.detail && (
            <span className={cn("truncate font-mono text-xs", summary.waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
              {summary.detail}
            </span>
          )}
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-[300px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs tracking-[0.06em] text-muted-foreground">RUNS</span>
          <span className="font-mono text-xs text-muted-foreground">{groups.length}</span>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: MAX_VISIBLE_RUN_ROWS * RUN_ROW_HEIGHT }}>
          {dayGroupedRows(groups, now).map(({ group, summary, dayLabel }) => (
            <Fragment key={group.run.id}>
              {dayLabel && <div className="px-3 pb-1 pt-2 font-mono text-[11px] text-muted-foreground/70">{dayLabel}</div>}
              <Console.RunRow
                {...summary}
                stale={group.run.stale === true}
                isSelected={group.run.id === selectedGroup?.run.id}
                onSelect={() => onSelect(group)}
              />
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

interface RunRowProps extends RunSummaryLine {
  stale: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

// Memoized so the tick that counts up an in-flight run only re-renders that
// run's row; every settled row holds a value that no longer changes.
Console.RunRow = memo(function RunRow({ name, detail, dotClass: dot, pending, waiting, agent, stale, isSelected, onSelect }: RunRowProps) {
  return (
    <DropdownMenuItem
      data-testid="console-row"
      className={cn("h-8 gap-3 rounded-none px-3", isSelected && "bg-accent", stale && "opacity-75")}
      onSelect={onSelect}
    >
      {pending && !waiting ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{name}</span>
      {agent && <Bot size={12} className="shrink-0 text-muted-foreground" aria-label="Run by an agent" />}
      <span className={cn("shrink-0 truncate font-mono text-xs", waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} title={detail}>
        {detail}
      </span>
    </DropdownMenuItem>
  );
});

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResponse]);

  let content;
  let rawText: string | undefined;
  if (activeTab === "request") {
    content = methodCall.input;
  } else if (hasError) {
    // Same rule as the response below: an HTTP failure arrives wrapped in what
    // carried it here, and the body the API sent is the failure.
    content = unwrapFailure(methodCall.error);
  } else if (isStreaming) {
    rawText = methodCall.streamOutputs!.map((msg) => JSON.stringify(unwrapEnvelope(methodCall.outputType, msg), null, 2)).join("\n\n");
  } else {
    // An app that carries HTTP inside gRPC has to put a body protobuf has no
    // shape for — an array, a scalar — in a field of its own. That field is the
    // encoding, not the response, so the response is what it holds.
    content = unwrapEnvelope(methodCall.outputType, methodCall.output);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The pane names itself: which part of the call on the left, and what
          came back of it on the right. Without the readout a successful call and
          an empty one look the same. */}
      <div className="flex h-[28px] shrink-0 items-center gap-4 overflow-hidden px-3">
        <Console.DetailTabs methodCall={methodCall} activeTab={activeTab} onTabChange={onTabChange} />
        {activeTab !== "headers" && <Console.ResponseSummary methodCall={methodCall} content={content} rawText={rawText} />}
      </div>
      {activeTab === "headers" ? (
        <Console.HeadersContent methodCall={methodCall} />
      ) : activeTab === "response" && !hasResponse ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Waiting for a response…</div>
      ) : (
        <>
          {activeTab === "response" && hasError && methodCall.url && (
            <div className="border-y border-border bg-destructive/10 px-4 py-1.5 font-mono text-xs text-destructive">POST {methodCall.url}</div>
          )}
          <JsonViewer ref={jsonViewerRef} value={content} rawText={rawText} />
        </>
      )}
    </div>
  );
};

interface DetailTabsProps {
  methodCall: MethodCall;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}

Console.DetailTabs = function ({ methodCall, activeTab, onTabChange }: DetailTabsProps) {
  const isStreaming = methodCall.streamOutputs !== undefined;
  const streamCount = isStreaming ? methodCall.streamOutputs!.length : 0;

  const tab = (id: ConsoleTab, label: string) => (
    <span className={cn(consoleTabClass, activeTab === id && consoleTabActiveClass)} onClick={() => onTabChange(id)}>
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

// What came back, how long it took and how big it is. Status colour appears
// here and in the call's dot, and nowhere else.
Console.ResponseSummary = function ({ methodCall, content, rawText }: ResponseSummaryProps) {
  const status = callStatus(methodCall);
  const label = { pending: "Pending", streaming: "Streaming", success: "OK", error: callErrorCode(methodCall) ?? "Error" }[status];
  const duration = formatDuration(methodCall.durationMs);
  const size = formatBytes(payloadBytes(content, rawText));
  const streamCount = methodCall.streamOutputs?.length;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap font-mono text-xs">
      <span data-testid="console-status" className={cn("shrink-0 font-medium", statusClass(status))}>
        {label}
      </span>
      {duration && <span className="shrink-0 tabular-nums text-muted-foreground @max-[430px]:hidden">{duration}</span>}
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

Console.HeadersContent = function ({ methodCall }: HeadersContentProps) {
  const requestHeaders = methodCall.requestHeaders || {};
  const responseHeaders = methodCall.responseHeaders || {};
  const upstreamRequestHeaders = methodCall.upstreamRequestHeaders || {};
  const upstreamResponseHeaders = methodCall.upstreamResponseHeaders || {};
  // The request line of the upstream call, which a failure reports and the
  // response no longer carries. A successful call doesn't report one.
  const upstreamRequest = upstreamRequestLine(methodCall.error);
  // An in-process app (e.g. OpenAPI) reports the headers it exchanged with its
  // upstream API. When present, the transport headers (browser ↔ Kaja) become a
  // second, less interesting hop shown below the upstream ones.
  const hasUpstream = upstreamRequest !== undefined || Object.keys(upstreamRequestHeaders).length > 0 || Object.keys(upstreamResponseHeaders).length > 0;

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

  const groupHeading = (text: string, caption: string, requestLine?: string) => (
    <div className="mb-3">
      <div className="font-semibold uppercase tracking-wider text-foreground">{text}</div>
      <div className="text-muted-foreground">{caption}</div>
      {requestLine && <div className="mt-1 break-all text-foreground">{requestLine}</div>}
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
      {hasUpstream ? (
        <>
          {groupHeading("Upstream", "Headers Kaja exchanged with the API", upstreamRequest)}
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

interface RunSummaryLine {
  name: string;
  // When it ran and how it went, in one string: `14:03 · 1.2 s`, `13:51 ·
  // waiting`, `13:44 · failed`.
  detail?: string;
  dotClass: string;
  pending: boolean;
  waiting: boolean;
  // Whether an agent pressed Run rather than a person. A console holds runs of
  // both, so it is the run that says it, not the file.
  agent: boolean;
}

// The columns every row in the history shares — the pill shows them for the
// selected run, the list for all of them.
function runSummary(group: RunGroup, groups: RunGroup[], now: number): RunSummaryLine {
  const waiting = group.awaiting !== undefined;
  const time = group.run.stale ? formatStaleTime(group.run.startedAt) : formatClockTime(group.run.startedAt);
  const outcome = waiting
    ? "waiting"
    : group.inFlight
      ? formatElapsed(now - group.run.startedAt)
      : group.status === "error"
        ? "failed"
        : formatDuration(group.run.durationMs);

  return {
    name: runName(group, groups),
    detail: outcome ? `${time} · ${outcome}` : time,
    dotClass: cn(waiting ? "bg-amber-500" : dotClass(group.status), group.run.stale && "opacity-50"),
    pending: group.inFlight,
    waiting,
    agent: group.run.origin === "agent",
  };
}

/**
 * A console holds one script's runs, so naming each one after that script says
 * the same thing every row. They are numbered instead, and the number is the
 * run's own — a position would renumber as the oldest runs are trimmed.
 */
function runName(group: RunGroup, groups: RunGroup[]): string {
  return `Run ${group.run.number ?? groups.indexOf(group) + 1}`;
}

interface DayGroupedRow {
  group: RunGroup;
  summary: RunSummaryLine;
  // Set on the first row of a day other than today, which is where the list
  // says what day it has moved to.
  dayLabel?: string;
}

// Newest first, so a label lands on the first row of each day the list moves
// back into; today needs none. Everything under a date header is by definition
// not live.
function dayGroupedRows(groups: RunGroup[], now: number): DayGroupedRow[] {
  const rows = [...groups].reverse().map((group) => ({ group, summary: runSummary(group, groups, now) }));
  let previousTimestamp = now;
  return rows.map((row) => {
    const timestamp = row.group.run.startedAt;
    const dayLabel = isSameDay(timestamp, previousTimestamp) ? undefined : formatDayLabel(timestamp);
    previousTimestamp = timestamp;
    return { ...row, dayLabel };
  });
}

function callStatus(methodCall: MethodCall): RunStatus {
  if (methodCall.error) return "error";
  const isStreaming = methodCall.streamOutputs !== undefined;
  if (isStreaming && !methodCall.streamComplete) return "streaming";
  return methodCall.output ? "success" : "pending";
}

// A run that isn't live is dated rather than clocked, because the time of day it
// happened on some other day is not the thing you need to read.
function formatStaleTime(timestamp: number): string {
  return isSameDay(timestamp, Date.now()) ? formatClockTime(timestamp) : formatDayLabel(timestamp);
}
