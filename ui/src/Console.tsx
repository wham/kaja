import { Check, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Copy, FoldVertical, Trash2, UnfoldVertical } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClockTime, formatDayLabel, formatElapsed, isSameDay } from "./callTime";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { unwrapEnvelope } from "./httpEnvelope";
import { JsonViewer, JsonViewerHandle } from "./JsonViewer";
import { MethodCall } from "./kaja";
import { callCount, ConsoleItem, ConsoleTab, followSelection, groupRuns, itemName, itemStatus, Run, RunGroup, RunSelection, RunStatus } from "./runs";
import { runShortcutLabel } from "./RunButton";
import { Log, LogLevel } from "./server/api";
import { unwrapFailure, upstreamRequestLine } from "./upstreamHeaders";

export type { ConsoleItem } from "./runs";

// The dropdown is a fixed 420px and scrolls after eight rows, so a long session
// never turns the console header into a full-height surface.
const RUN_ROW_HEIGHT = 32;
const MAX_VISIBLE_RUN_ROWS = 8;
// Beyond this the qualified call name is truncated from the left, so the method
// — the part that identifies the call — survives.
const MAX_TRIGGER_NAME_LENGTH = 28;
// Both time columns are reserved: the longest value they can ever hold sets the
// geometry once, so nothing moves as calls settle and age.
const DETAIL_COLUMN_CLASS = "w-[9ch] shrink-0 truncate text-right font-mono text-xs tabular-nums text-muted-foreground";
const TIME_COLUMN_CLASS = "w-[8ch] shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground";

const consoleTabClass = "cursor-pointer select-none whitespace-nowrap text-sm text-muted-foreground hover:text-foreground";
const consoleTabActiveClass = "font-medium text-foreground";
// Utilities carry no resting chrome: they are worth no more weight than the tabs
// beside them.
const utilityButtonClass = "h-6 w-6 rounded-md hover:bg-accent hover:text-foreground";

interface ConsoleProps {
  // Which file's console this is. It is the whole scope: the runs are that
  // file's runs, and changing it swaps consoles rather than reporting a new run.
  fileId?: string;
  runs: Run[];
  items: ConsoleItem[];
  // Where the console is pointing and what it is showing of the selected call.
  // Both are kept per file by the caller, so coming back finds it as it was.
  selection: RunSelection | null;
  tab: ConsoleTab;
  onSelect: (selection: RunSelection | null) => void;
  onTabChange: (tab: ConsoleTab) => void;
  onClear?: () => void;
}

export function Console({ fileId, runs, items, selection, tab: activeTab, onSelect, onTabChange, onClear }: ConsoleProps) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const jsonViewerRef = useRef<JsonViewerHandle | null>(null);

  const groups = useMemo(() => groupRuns(runs, items), [runs, items]);
  const newest = groups[groups.length - 1];

  // A settled call shows the wall-clock time it was made, which never changes —
  // so the clock only runs while something is still in flight, counting up in
  // tenths for the call that is.
  const hasInFlight = groups.some((group) => group.inFlight);

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [hasInFlight]);

  // The file and run the console has followed, which is what tells a run
  // arriving apart from a call arriving inside the one already on screen — and
  // both apart from the console being handed a different file altogether.
  const followedRef = useRef<{ fileId?: string; runId?: string }>({});

  useEffect(() => {
    const sameFile = followedRef.current.fileId === fileId;
    const isNewRun = sameFile && followedRef.current.runId !== newest?.run.id;
    followedRef.current = { fileId, runId: newest?.run.id };
    // Arriving at another file is not a run arriving: its own selection has just
    // been restored, and only a selection with nothing left to point at is
    // moved on to the newest run.
    const next = followSelection(selection, groups, isNewRun);
    if (next?.runId !== selection?.runId || next?.itemId !== selection?.itemId) onSelect(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, newest?.run.id, newest?.items.length, groups.length]);

  const selectedGroup = groups.find((group) => group.run.id === selection?.runId);
  const selectedItem = selectedGroup?.items.find((item) => item.id === selection?.itemId);
  const selectedCall = selectedItem?.call;
  const selectedLogs = selectedItem?.logs;

  const selectRun = useCallback(
    (group: RunGroup) => {
      const last = group.items[group.items.length - 1];
      onSelect({ runId: group.run.id, itemId: last?.id });
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
    jsonViewerRef.current?.copyToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, []);

  // With no run there is no selection to show and no tabs to choose between:
  // a selected Response over an empty panel implies a state the console doesn't
  // have. The empty line is the only thing that should speak.
  if (groups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-xs text-muted-foreground">
        Run a script to see its calls here — <span className="ml-1 font-mono">{runShortcutLabel}</span>
      </div>
    );
  }

  const showUtilities = selectedCall !== undefined && (activeTab === "request" || activeTab === "response");
  const position = selectedGroup ? groups.indexOf(selectedGroup) + 1 : groups.length;
  // The header row is what ties a script's calls to the press that made them, so
  // it appears whenever there is more than one — and on a stale run, where it is
  // the only place that can say "this is not live".
  const showRunHeader = selectedGroup !== undefined && (selectedGroup.items.length > 1 || selectedGroup.run.stale === true);
  const showRunChildren = (selectedGroup?.items.length ?? 0) > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* One row spanning the full console width: which run, how to step through
          them, what to look at, and what to do with it. Narrowing it never wraps
          a second line. Everything holds its size and leaves in order of what it
          is worth — the run's time, then its call count, then the stepper (whose
          history the trigger and ⌃↑/⌃↓ still reach), then the payload utilities
          — and the run's name truncates through all of it. */}
      <div className="@container flex h-[35px] shrink-0 items-center gap-3 overflow-hidden border-b border-border px-3">
        <Console.RunSelect groups={groups} selectedGroup={selectedGroup} onSelect={selectRun} onClear={onClear} now={now} />
        <div className="flex shrink-0 items-center gap-1 @max-[540px]:hidden">
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
        {selectedCall && (
          <>
            <div className="h-4 w-px shrink-0 bg-border" />
            <Console.DetailTabs methodCall={selectedCall} activeTab={activeTab} onTabChange={onTabChange} />
          </>
        )}
        {showUtilities && (
          <div className="ml-auto flex shrink-0 items-center gap-2 @max-[430px]:hidden">
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

      {/* The response owns the full width of the console below the header, on
          the same sunken surface as the editor — the split between them is a
          hairline, not a value step. */}
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {selectedGroup && showRunHeader && (
          <Console.RunHeaderRow
            group={selectedGroup}
            selected={selection?.itemId === undefined}
            expanded={showRunChildren}
            onSelect={() => onSelect({ runId: selectedGroup.run.id })}
            now={now}
          />
        )}
        {selectedGroup &&
          showRunChildren &&
          selectedGroup.items.map((item) => (
            <Console.CallChildRow
              key={item.id}
              item={item}
              selected={item.id === selection?.itemId}
              onSelect={() => onSelect({ runId: selectedGroup.run.id, itemId: item.id })}
              now={now}
            />
          ))}
        <div className={cn("flex min-h-0 flex-1 flex-col", selectedGroup?.run.stale && "opacity-70")}>
          {selectedGroup?.run.payloadsExpired ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-xs text-muted-foreground">Response no longer kept — run to see it live</span>
              <span className="font-mono text-xs text-muted-foreground">{runShortcutLabel}</span>
            </div>
          ) : selectedCall ? (
            <Console.DetailContent methodCall={selectedCall} activeTab={activeTab} onTabChange={onTabChange} jsonViewerRef={jsonViewerRef} />
          ) : selectedLogs ? (
            <Console.LogContent logs={selectedLogs} />
          ) : selectedGroup ? (
            <Console.RunSummary group={selectedGroup} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface RunSelectProps {
  groups: RunGroup[];
  selectedGroup?: RunGroup;
  onSelect: (group: RunGroup) => void;
  onClear?: () => void;
  now: number;
}

// The whole history behind one 26px trigger: the trigger answers "which run am I
// looking at", the list answers "which other ones are there". It lists runs
// rather than calls, so everything under a date header is by definition not
// live.
Console.RunSelect = function ({ groups, selectedGroup, onSelect, onClear, now }: RunSelectProps) {
  const [open, setOpen] = useState(false);
  const summary = selectedGroup ? runSummary(selectedGroup, now) : undefined;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="console-call-select"
          className="flex h-[26px] min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 hover:bg-accent"
          title={summary?.name}
        >
          {summary?.pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", summary?.dotClass)} />}
          <span className="max-w-[190px] truncate font-mono text-xs text-foreground">{truncateStart(summary?.name ?? "", MAX_TRIGGER_NAME_LENGTH)}</span>
          {summary?.detail && (
            <span className={cn(DETAIL_COLUMN_CLASS, "@max-[620px]:hidden")} title={summary.detail}>
              {summary.detail}
            </span>
          )}
          {summary?.time && <span className={cn(TIME_COLUMN_CLASS, "@max-[700px]:hidden")}>{summary.time}</span>}
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-[420px] p-0">
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
// run's row; every settled row holds a value that no longer changes. Both
// columns are rendered even when empty, so the list stays aligned.
Console.RunRow = memo(function RunRow({ name, detail, time, dotClass, pending, stale, isSelected, onSelect }: RunRowProps) {
  return (
    <DropdownMenuItem
      data-testid="console-row"
      className={cn("h-8 gap-3 rounded-none px-3", isSelected && "bg-accent", stale && "opacity-75")}
      onSelect={onSelect}
    >
      {pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{name}</span>
      <span className={DETAIL_COLUMN_CLASS} title={detail}>
        {detail}
      </span>
      <span className={TIME_COLUMN_CLASS}>{time}</span>
    </DropdownMenuItem>
  );
});

interface RunHeaderRowProps {
  group: RunGroup;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  now: number;
}

// One press of Run, stated once: status, script name, what happened, wall
// duration, clock. Its status is the worst status inside it, so a green run
// means every call passed.
Console.RunHeaderRow = function ({ group, selected, expanded, onSelect, now }: RunHeaderRowProps) {
  const { run, status, inFlight, failures } = group;
  const calls = callCount(group);

  return (
    <div
      data-testid="console-run-header"
      className={cn("flex h-8 shrink-0 cursor-pointer items-center gap-2 border-b border-border px-3", selected ? "bg-accent" : "bg-card")}
      onClick={onSelect}
    >
      <span className="flex w-[13px] shrink-0 items-center justify-center text-muted-foreground">
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </span>
      {inFlight ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(status), run.stale && "opacity-50")} />}
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", run.stale ? "text-muted-foreground" : "font-medium text-foreground")}>{run.title}</span>
      {run.stale && <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Last run</span>}
      {/* What failed is the news; how many calls there were is what the trigger
          already carries. */}
      {failures > 0 ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{failures} failed</span>
      ) : (
        calls > 1 && <span className="shrink-0 font-mono text-xs text-muted-foreground">{calls} calls</span>
      )}
      <span className={DETAIL_COLUMN_CLASS}>{inFlight ? formatElapsed(now - run.startedAt) : formatDuration(run.durationMs)}</span>
      <span className={cn(TIME_COLUMN_CLASS, "opacity-75")}>{run.stale ? formatStaleTime(run.startedAt) : formatClockTime(run.startedAt)}</span>
    </div>
  );
};

interface CallChildRowProps {
  item: ConsoleItem;
  selected: boolean;
  onSelect: () => void;
  now: number;
}

// Calls inside a run are ordered by start, never re-sorted, and keep their own
// durations; the run header's duration is the wall time for the whole script.
Console.CallChildRow = function ({ item, selected, onSelect, now }: CallChildRowProps) {
  const status = itemStatus(item);
  const pending = item.call !== undefined && (status === "pending" || status === "streaming");
  const errorCode = item.call ? callErrorCode(item.call) : undefined;

  return (
    <div
      data-testid="console-call-row"
      className={cn("flex h-[30px] shrink-0 cursor-pointer items-center gap-2 border-b border-border pl-[34px] pr-3", selected && "bg-accent")}
      onClick={onSelect}
    >
      {pending ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(status))} />}
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", selected ? "text-foreground" : "text-muted-foreground")}>{itemName(item)}</span>
      {errorCode && <span className="shrink-0 font-mono text-xs text-destructive">{errorCode}</span>}
      <span className={DETAIL_COLUMN_CLASS}>{pending ? formatElapsed(now - item.timestamp) : formatDuration(item.call?.durationMs)}</span>
    </div>
  );
};

// What the run header selects: the press as a whole, rather than any one call it
// made.
Console.RunSummary = function ({ group }: { group: RunGroup }) {
  const calls = callCount(group);
  const label = { pending: "Running", streaming: "Streaming", success: "OK", error: "Failed" }[group.status];

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs">
      <div className="flex items-center gap-3 pb-2">
        <span className={cn("font-medium", statusClass(group.status))}>{label}</span>
        <span className="text-muted-foreground">
          {calls} {calls === 1 ? "call" : "calls"}
        </span>
        {group.run.durationMs !== undefined && <span className="tabular-nums text-muted-foreground">{formatDuration(group.run.durationMs)} wall</span>}
      </div>
      {group.items.length === 0 ? (
        <div className="text-muted-foreground">This run made no calls.</div>
      ) : (
        group.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 py-0.5">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(itemStatus(item)))} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{itemName(item)}</span>
            <span className="tabular-nums text-muted-foreground">{formatDuration(item.call?.durationMs)}</span>
          </div>
        ))
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

  // A failed call colours its dot and its status line, and nothing else — the
  // header stays neutral.
  return (
    <div className="flex shrink-0 items-center gap-4">
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
  // The call count, or how many of them failed.
  detail?: string;
  // Wall-clock time the run was made.
  time?: string;
  dotClass: string;
  pending: boolean;
}

// The columns every row in the history shares — the trigger shows them for the
// selected run, the list for all of them.
function runSummary(group: RunGroup, now: number): RunSummaryLine {
  const calls = callCount(group);
  return {
    name: group.run.title,
    // While the run is in flight its own elapsed time is the interesting number;
    // once it lands, how many calls it made — and for a run of one, where there
    // is no count worth stating, how long it took.
    detail: group.inFlight ? formatElapsed(now - group.run.startedAt) : calls > 1 ? `${calls} calls` : formatDuration(group.run.durationMs),
    time: group.run.stale ? formatStaleTime(group.run.startedAt) : formatClockTime(group.run.startedAt),
    dotClass: cn(dotClass(group.status), group.run.stale && "opacity-50"),
    pending: group.inFlight,
  };
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
  const rows = [...groups].reverse().map((group) => ({ group, summary: runSummary(group, now) }));
  let previousTimestamp = now;
  return rows.map((row) => {
    const timestamp = row.group.run.startedAt;
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

function statusClass(status: RunStatus): string {
  return {
    pending: "text-muted-foreground",
    streaming: "text-primary",
    success: "text-emerald-600 dark:text-emerald-400",
    error: "text-destructive",
  }[status];
}

function dotClass(status: RunStatus): string {
  return {
    pending: "bg-muted-foreground",
    streaming: "bg-primary",
    success: "bg-emerald-500",
    error: "bg-red-500",
  }[status];
}

// gRPC and Twirp errors carry a status code (e.g. "INVALID_ARGUMENT"); anything
// else just shows as a plain error.
// How a failed call is labelled: an upstream HTTP failure by its status, and
// anything else by its gRPC/Twirp status code. A call against an HTTP app failed
// with a 404, not with NOT_FOUND — the gRPC code is the tunnel, not the failure.
function callErrorCode(methodCall: MethodCall): string | undefined {
  const status = methodCall.error?.status;
  if (typeof status === "number" && status > 0) return String(status);
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
