import { Bot, Check, ChevronDown, ChevronsUpDown, ChevronUp, Copy, FoldVertical, Logs, Trash2, UnfoldVertical } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApproveGesture, blockText } from "./blocks";
import { dotClass, formatDuration } from "./callFormat";
import { formatClockTime, formatDayLabel, formatElapsed, isSameDay } from "./callTime";
import { Canvas } from "./Canvas";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { SegmentedControl } from "./components/segmented-control";
import { Spinner } from "./components/spinner";
import { consoles } from "./consoles";
import { JsonViewerHandle } from "./JsonViewer";
import { RunLog } from "./RunLog";
import { callRows, ConsoleItem, ConsoleTab, ConsoleView, defaultView, followSelection, LogFloor, printedCounts, RunGroup, RunSelection } from "./runs";
import { runShortcutLabel } from "./RunButton";
import { TableView } from "./tableView";

export type { ConsoleItem } from "./runs";

// The dropdown is a fixed 420px and scrolls after eight rows, so a long session
// never turns the console header into a full-height surface.
const RUN_ROW_HEIGHT = 32;
const MAX_VISIBLE_RUN_ROWS = 8;

// Utilities carry no resting chrome: they are worth no more weight than the tabs
// beside them.
const utilityButtonClass = "h-6 w-6 rounded-md hover:bg-accent hover:text-foreground";

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
  const logFloor = file.logFloor;
  // The merge is a walk of two ordered lists, so it is cheap — but it is read on
  // every repaint of a run that may be thousands long, and both sides only ever
  // grow at the end. Memoizing on the lengths is what makes a repaint that
  // changed nothing cost nothing.
  const rows = useMemo(
    () => (selectedGroup ? callRows(selectedGroup, logFloor) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedGroup, selectedGroup?.calls.length, selectedGroup?.printed.length, logFloor],
  );
  const printed = useMemo(() => (selectedGroup ? printedCounts(selectedGroup) : { lines: 0, errors: 0 }), [selectedGroup, selectedGroup?.printed.length]);
  const selectedItem = selection?.itemId !== undefined ? rows.find((item) => item.id === selection.itemId) : undefined;
  const selectedCall = selectedItem?.call;
  const activeView = file.view ?? defaultView(selectedGroup);
  const waiting = selectedGroup?.awaiting;
  const onLogFloorChange = useCallback((floor: LogFloor) => consoles.setLogFloor(fileId, floor, Date.now()), [fileId]);

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
      onViewChange("calls");
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
          {/* "Calls" rather than "Log": a row here is a call and only a call,
              and "log" is what anyone means by what a script printed — which is
              now a thing this view can mix in. */}
          <SegmentedControl.Button
            selected={activeView === "calls"}
            className="h-[20px] px-2.5 py-0 text-xs"
            onClick={() => onViewChange("calls")}
            data-testid="console-view-calls"
          >
            Calls
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
        {/* Only there when the run printed something, on the same rule as
            everything else in this header: a control over nothing is chrome. */}
        {activeView === "calls" && printed.lines > 0 && (
          <Console.LogFloorSelect floor={logFloor} lines={printed.lines} errors={printed.errors} onChange={onLogFloorChange} />
        )}
        {showUtilities && (
          <div className="ml-auto flex shrink-0 items-center gap-2 @max-[430px]:hidden">
            {activeView === "calls" && (
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
        <RunLog
          group={selectedGroup}
          rows={rows}
          selectedItemId={selection?.itemId}
          activeTab={activeTab}
          selectedItem={selectedItem}
          waiting={waiting !== undefined}
          logFloor={logFloor}
          printed={printed}
          jsonViewerRef={jsonViewerRef}
          now={now}
          tailing={tailing}
          tailingRef={tailingRef}
          onTailingChange={setTailing}
          onSelectRow={selectRow}
          onTabChange={onTabChange}
          onShowLogs={() => onLogFloorChange("all")}
          onGoToCanvas={() => onViewChange("canvas")}
        />
      ) : null}
    </div>
  );
}

const FLOOR_LABELS: { floor: LogFloor; label: string; note: string }[] = [
  { floor: "off", label: "Off", note: "Calls only" },
  { floor: "error", label: "Errors", note: "console.error" },
  { floor: "warn", label: "Warnings", note: "console.warn and above" },
  { floor: "all", label: "All", note: "Everything the script printed" },
];

/**
 * How much of what the script printed the calls view mixes in.
 *
 * A floor rather than a checkbox per level: the levels are ordered, and
 * "warnings but not errors" is not a question anyone asks. It is one control
 * because four switches over a list that is usually empty is more chrome than
 * the thing it configures.
 */
Console.LogFloorSelect = function ({
  floor,
  lines,
  errors,
  onChange,
}: {
  floor: LogFloor;
  lines: number;
  errors: number;
  onChange: (floor: LogFloor) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = floor !== "off";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="console-log-floor"
          aria-label="Include what the script printed"
          className={cn(
            "ml-auto flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs @max-[430px]:hidden",
            active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Logs size={13} />
          <span className="font-mono tabular-nums">{lines}</span>
          {errors > 0 && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-label={`${errors} printed at error level`} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-[240px] p-0">
        <div className="border-b border-border px-3 py-2 text-xs tracking-[0.06em] text-muted-foreground">SCRIPT LOG</div>
        {FLOOR_LABELS.map((option) => (
          <DropdownMenuItem
            key={option.floor}
            className={cn("h-9 gap-3 rounded-none px-3", option.floor === floor && "bg-accent")}
            onSelect={() => {
              onChange(option.floor);
              setOpen(false);
            }}
          >
            <span className="w-3 shrink-0">{option.floor === floor && <Check size={13} />}</span>
            <span className="flex-1 text-xs text-foreground">{option.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{option.note}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

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

// A run that isn't live is dated rather than clocked, because the time of day it
// happened on some other day is not the thing you need to read.
function formatStaleTime(timestamp: number): string {
  return isSameDay(timestamp, Date.now()) ? formatClockTime(timestamp) : formatDayLabel(timestamp);
}
