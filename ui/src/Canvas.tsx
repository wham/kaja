import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleX, RotateCw, Search, ShieldQuestionMark, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { answerPlaceholder, answerProblem, AskAnswerType, normalizeAnswer, typeaheadIndex, TYPEAHEAD_MS } from "./ask";
import { ApproveBlock, ApproveGesture, AskBlock, Block, CellStatus, cellStatus, CodeBlock, PerfBlock, RateLimitBlock, TableBlock, TextBlock } from "./blocks";
import { RateLimitState } from "./rateLimit";
import { formatBytes, formatDuration } from "./callFormat";
import { cn } from "./cn";
import { Button } from "./components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { Spinner } from "./components/spinner";
import {
  bodyMinHeight,
  CellRef,
  cellsKey,
  hasControls,
  NO_TABLE_VIEW,
  numericColumns,
  pendingCells,
  pullNeeded,
  searchesLocally,
  tableSummary,
  tableWindow,
  TableView,
} from "./tableView";
import { ConsoleItem, FailureNotice, RunGroup } from "./runs";
import { barHeight, BAR_MAX_HEIGHT, slotsFor, SLOT_WIDTH, StripSlot, TICK_HEIGHT, TICK_WIDTH } from "./runStrip";
import { exclusionNote, StatTiles, TileCell } from "./Stats";
import { formatErrorRate, formatMs, formatRps } from "./statsChart";
import { Log, LogLevel } from "./server/api";

// What the counts and the label at the end of the strip need before the marks get
// any room. The strip is what is left of the row after them.
const STRIP_RESERVE = 160;

// How much of a held request is shown before it starts claiming room the document
// needs. Past this it fades and says how much it kept back, with Expand beside it.
const APPROVE_CLIP_LINES = 12;

// A page off a local server is back inside a frame or two, and a dim that flashes
// for 40ms reads as a glitch rather than as progress.
const TABLE_LOADING_DELAY_MS = 150;

// Fixed rather than random: widths that re-roll on every render look like activity
// that isn't there.
const SKELETON_WIDTHS = ["58%", "76%", "44%", "66%", "52%", "70%"];

interface CanvasProps {
  group: RunGroup;
  // A size, not a mode: everything below reads it only to decide how much air a
  // block is given.
  fullScreen?: boolean;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  onSelectCall: (itemId: string) => void;
  onFullScreen?: () => void;
  // Handed down to a perf block, which is a headline and the way to the page
  // its charts are on.
  onOpenStats?: () => void;
  // Carried across entering and leaving full-screen, so the way back lands where you
  // left rather than at the top.
  scrollRef?: React.MutableRefObject<number>;
  // View state rather than something the run drew, so it is held above the canvas
  // and survives switching views.
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
  onTableCells: (blockId: string, cells: CellRef[]) => void;
}

/**
 * What the run drew, in emission order, and nothing else. A call is not a block and
 * is not drawn as one — the strip above states every call the run made.
 */
export function Canvas({
  group,
  fullScreen,
  onAnswer,
  onCancelAsk,
  onDecide,
  onSelectCall,
  onFullScreen,
  onOpenStats,
  scrollRef,
  tableViews,
  onTableView,
  onTablePull,
  onTableCells,
}: CanvasProps) {
  const drawn = group.drawn;
  const unreported = group.unreported;
  const scroller = useRef<HTMLDivElement>(null);

  // The same document in another container, so the offset is carried rather than the
  // element.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !scrollRef) return;
    element.scrollTop = scrollRef.current;
    const remember = () => void (scrollRef.current = element.scrollTop);
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      element.removeEventListener("scroll", remember);
    };
  }, [scrollRef, fullScreen]);

  if (group.run.payloadsExpired) {
    return <Canvas.Notice>Canvas no longer kept — run to see it live</Canvas.Notice>;
  }
  if (group.items.length === 0) {
    return <Canvas.Notice>{group.running ? "Waiting for the first call…" : "This run drew nothing."}</Canvas.Notice>;
  }
  if (drawn.length === 0 && unreported.length === 0) {
    return <Canvas.Notice>{group.running ? "Nothing drawn yet…" : "This run drew nothing."}</Canvas.Notice>;
  }

  return (
    <div
      ref={scroller}
      data-testid="canvas"
      className={cn(
        "@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto font-mono text-xs",
        fullScreen ? "px-8 py-6" : "p-3",
        group.run.stale && "opacity-70",
      )}
    >
      {drawn.map((item) => (
        // Blocks keep their full height and the canvas scrolls. Without this a long table
        // is squeezed to a couple of rows to make the run fit.
        <div key={item.id} className="shrink-0">
          <Canvas.Entry
            item={item}
            fullScreen={fullScreen}
            onAnswer={onAnswer}
            onCancelAsk={onCancelAsk}
            onDecide={onDecide}
            onFullScreen={onFullScreen}
            onOpenStats={onOpenStats}
            tableViews={tableViews}
            onTableView={onTableView}
            onTablePull={onTablePull}
            onTableCells={onTableCells}
          />
        </div>
      ))}
      {unreported.map((failure) => (
        <div key={failure.itemId} className="shrink-0">
          <Canvas.Failure failure={failure} onOpen={() => onSelectCall(failure.itemId)} />
        </div>
      ))}
    </div>
  );
}

interface RunStripProps {
  group: RunGroup;
  onSelectCall: (itemId: string) => void;
}

/**
 * The run's calls as one 28px row under the console header. The mode is decided by
 * the room, not by a count: one tick per call for as long as a tick can still be a
 * tick, and buckets past that.
 */
Canvas.RunStrip = function ({ group, onSelectCall }: RunStripProps) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const slots = slotsFor(width - STRIP_RESERVE);
  const view = group.strip.view(slots);
  const slowest = group.stats.slowest;
  const calls = group.strip.calls;
  const failures = group.strip.failures;
  const label = group.strip.methodLabel;

  return (
    <div ref={row} data-testid="run-strip" className="@container flex h-[28px] shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-xs">
      {view.slots.length > 0 && (
        <span
          className={cn("flex min-w-0 shrink overflow-hidden", view.mode === "bars" && "items-end")}
          style={{ gap: SLOT_WIDTH - TICK_WIDTH, height: BAR_MAX_HEIGHT }}
        >
          {view.slots.map((slot) => (
            <button
              key={slot.itemId}
              type="button"
              data-testid="run-strip-slot"
              className={cn(
                "block shrink-0 rounded-sm hover:bg-foreground/60",
                slot.failures > 0 ? "bg-destructive/70" : slot.calls === 0 ? "bg-muted-foreground/30" : "bg-muted-foreground/60",
              )}
              style={{ width: TICK_WIDTH, height: view.mode === "ticks" ? TICK_HEIGHT : barHeight(slot.slowest, slowest) }}
              title={slotTitle(slot)}
              aria-label={slotTitle(slot)}
              onClick={() => onSelectCall(slot.itemId)}
            />
          ))}
        </span>
      )}
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
        {calls.toLocaleString()} {calls === 1 ? "call" : "calls"}
      </span>
      {failures > 0 && <span className="shrink-0 whitespace-nowrap text-destructive">{failures.toLocaleString()} failed</span>}
      {label && <span className="ml-auto min-w-0 truncate text-muted-foreground @max-[420px]:hidden">{label}</span>}
    </div>
  );
};

// One call names itself; a bucket says how many it holds and how slow the slowest
// of them was, which is the whole reason it has a height.
function slotTitle(slot: StripSlot): string {
  const duration = formatDuration(slot.slowest > 0 ? slot.slowest : undefined);
  if (slot.method !== undefined) return [slot.method, duration].filter(Boolean).join(" · ");
  const parts = [`${slot.calls.toLocaleString()} calls`];
  if (duration) parts.push(`slowest ${duration}`);
  if (slot.failures > 0) parts.push(`${slot.failures} failed`);
  return parts.join(" · ");
}

Canvas.Notice = function ({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-muted-foreground">{children}</div>;
};

interface EntryProps {
  item: ConsoleItem;
  fullScreen?: boolean;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  onFullScreen?: () => void;
  // The perf block's way to the page its charts are on.
  onOpenStats?: () => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
  onTableCells: (blockId: string, cells: CellRef[]) => void;
}

Canvas.Entry = function ({
  item,
  fullScreen,
  onAnswer,
  onCancelAsk,
  onDecide,
  onFullScreen,
  onOpenStats,
  tableViews,
  onTableView,
  onTablePull,
  onTableCells,
}: EntryProps) {
  if (item.logs) return <Canvas.Logs logs={item.logs} />;
  if (!item.block) return null;
  return (
    <Canvas.Block
      id={item.id}
      block={item.block}
      fullScreen={fullScreen}
      onAnswer={onAnswer}
      onCancelAsk={onCancelAsk}
      onDecide={onDecide}
      onFullScreen={onFullScreen}
      onOpenStats={onOpenStats}
      tableViews={tableViews}
      onTableView={onTableView}
      onTablePull={onTablePull}
      onTableCells={onTableCells}
    />
  );
};

interface BlockProps {
  id: string;
  block: Block;
  fullScreen?: boolean;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  onFullScreen?: () => void;
  // The perf block's way to the page its charts are on.
  onOpenStats?: () => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
  onTableCells: (blockId: string, cells: CellRef[]) => void;
}

Canvas.Block = function ({
  id,
  block,
  fullScreen,
  onAnswer,
  onCancelAsk,
  onDecide,
  onFullScreen,
  onOpenStats,
  tableViews,
  onTableView,
  onTablePull,
  onTableCells,
}: BlockProps) {
  switch (block.kind) {
    case "text":
      return <Canvas.Text block={block} fullScreen={fullScreen} />;
    case "code":
      return <Canvas.Code block={block} />;
    case "table":
      return <Canvas.Table id={id} block={block} view={tableViews[id] ?? NO_TABLE_VIEW} onView={onTableView} onPull={onTablePull} onCells={onTableCells} />;
    case "ask":
      return <Canvas.Ask id={id} block={block} onAnswer={onAnswer} onCancelAsk={onCancelAsk} />;
    case "approve":
      return <Canvas.Approve id={id} block={block} fullScreen={fullScreen} onDecide={onDecide} onFullScreen={onFullScreen} />;
    case "perf":
      return <Canvas.Perf block={block} onOpenStats={onOpenStats} />;
    case "limit":
      return <Canvas.Limit block={block} />;
  }
};

// Clear, pacing, held — the three the mechanism actually has. Amber and red here are
// about the traffic and stay inside this frame: a run waiting on a clock is not a run
// waiting on you, so nothing outside lights up for it.
const LIMIT_LAMP: { [state in RateLimitState]: string } = {
  clear: "bg-emerald-600 dark:bg-emerald-400",
  pacing: "bg-amber-600 dark:bg-amber-400",
  held: "bg-destructive",
};

const LIMIT_SAID: { [state in RateLimitState]: string } = {
  clear: "clear",
  pacing: "pacing",
  held: "held",
};

/**
 * What a rate limiter draws: a signal, the budget draining behind it, and what obeying
 * it has cost. A headline rather than a control — the only button this could offer is
 * one that ignores the API.
 */
Canvas.Limit = function ({ block }: { block: RateLimitBlock }) {
  const cells: TileCell[] = [
    {
      label: "budget",
      value:
        block.limit === undefined ? (block.remaining?.toLocaleString() ?? "—") : `${(block.remaining ?? 0).toLocaleString()} / ${block.limit.toLocaleString()}`,
    },
    { label: "calls", value: block.calls.toLocaleString() },
    { label: "held", value: block.held.toLocaleString() },
    { label: "waited", value: (block.waitedMs > 0 ? formatDuration(block.waitedMs) : undefined) ?? "—" },
  ];
  // Absent until the API says both, and never past full or below empty.
  const share = block.limit !== undefined && block.limit > 0 ? Math.min(1, Math.max(0, (block.remaining ?? 0) / block.limit)) : undefined;
  const note = [
    block.declared !== undefined ? `capped at ${block.declared}` : undefined,
    block.refusals !== undefined ? `${block.refusals.toLocaleString()} refused` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <div data-testid="canvas-limit" className="overflow-hidden rounded-lg border border-border">
      <div className="flex h-[28px] items-center gap-2 border-b border-border bg-card px-3">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", LIMIT_LAMP[block.state])} />
        <span className="shrink-0 text-xs text-muted-foreground">rate limit</span>
        <span className="min-w-0 truncate font-mono text-xs text-foreground">{block.app}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{LIMIT_SAID[block.state]}</span>
        {block.waiting !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{block.waiting} waiting</span>}
        {block.resetInMs !== undefined && (
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">resets in {formatDuration(Math.round(block.resetInMs))}</span>
        )}
      </div>
      {share !== undefined && (
        <div className="h-[3px] w-full bg-muted">
          <div className={cn("h-full transition-[width] duration-200", LIMIT_LAMP[block.state])} style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <StatTiles cells={cells} note={note === "" ? undefined : note} />
    </div>
  );
};

/**
 * What a perf test leaves on the canvas: the headline, and the way to the rest of it.
 * A test that ran for a minute has to show for itself here — a presented run has no
 * other surface — but the charts belong on the page built for them, so this is the
 * tile strip and a link rather than a second copy of it.
 */
Canvas.Perf = function ({ block, onOpenStats }: { block: PerfBlock; onOpenStats?: () => void }) {
  const cells: TileCell[] = [
    { label: "requests", value: block.requests.toLocaleString() },
    {
      label: "error rate",
      value: formatErrorRate(block.errorRate, block.failures),
      className: block.failures > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
    },
    { label: "mean rps", value: formatRps(block.meanRps) },
    { label: "p50", value: formatMs(block.p50) },
    { label: "p95", value: formatMs(block.p95) },
    { label: "p99", value: formatMs(block.p99) },
  ];
  return (
    <div data-testid="canvas-perf" className="overflow-hidden rounded-lg border border-border">
      <div className="flex h-[28px] items-center gap-2 border-b border-border bg-card px-3">
        {block.running && <Spinner className="h-3 w-3 shrink-0" />}
        <span className="shrink-0 text-xs text-muted-foreground">perf test</span>
        <span className="min-w-0 truncate font-mono text-xs text-foreground">{block.schedule}</span>
        {block.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatDuration(Math.round(block.durationMs))}</span>
        )}
        {onOpenStats && (
          <button type="button" className="ml-auto shrink-0 font-mono text-xs text-primary hover:underline" onClick={onOpenStats}>
            Open stats
          </button>
        )}
      </div>
      <StatTiles cells={cells} note={exclusionNote({ excludedWarmup: block.excludedWarmup ?? 0, excludedFailures: block.excludedFailures ?? 0 })} />
    </div>
  );
};

// Prose is measured rather than left to the container: a table wants the whole
// width and a paragraph wants a line you can come back from. The canvas is mono,
// so a ch is one character and the measure is a column count — 80, the one a mono
// surface is already read at, so an ordinary one-sentence note stays one line.
Canvas.Text = function ({ block, fullScreen }: { block: TextBlock; fullScreen?: boolean }) {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-foreground" style={{ maxWidth: fullScreen ? "100ch" : "80ch" }}>
      {block.text}
    </div>
  );
};

Canvas.Code = function ({ block }: { block: CodeBlock }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {block.language && <div className="border-b border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{block.language}</div>}
      <pre className="overflow-x-auto px-2.5 py-2 leading-relaxed text-foreground">{block.code}</pre>
    </div>
  );
};

interface TableProps {
  id: string;
  block: TableBlock;
  view: TableView;
  onView: (blockId: string, view: TableView) => void;
  onPull: (blockId: string, search: string, want: number) => void;
  onCells: (blockId: string, cells: CellRef[]) => void;
}

/**
 * The one block wider than the text around it, so the one block with a frame —
 * without it the header row reads as another line of the paragraph above.
 *
 * A wide table scrolls inside itself; the canvas never scrolls sideways as a whole.
 *
 * The pager is over rows rather than requests: paging past what is loaded is what
 * pulls the source. A search the source takes restarts it; one it doesn't filters
 * the rows already here and says so, because a local filter that fetched would pull
 * an API dry to find three rows.
 *
 * Paging moves nothing: the frame keeps the height of a full page while the table
 * can still page, and the page on screen stays, dimmed, until the next is here. Only
 * a first draw has nothing to dim, which is what the skeleton rows are for.
 */
Canvas.Table = function ({ id, block, view, onView, onPull, onCells }: TableProps) {
  const shown = tableWindow(block, view);
  const controls = hasControls(block);
  const busy = useDelayed(block.loading === true, TABLE_LOADING_DELAY_MS);
  // The press is remembered rather than the direction: the page can be clamped, and a
  // pull can start without either button being touched.
  const [pressed, setPressed] = useState<"previous" | "next" | undefined>(undefined);
  // Forgotten once the page it asked for is here, and not before: the pull it started
  // is one effect away, so clearing on "not loading yet" clears between the click and
  // the fetch it caused.
  if (pressed !== undefined && block.loading !== true && !shown.pending) setPressed(undefined);

  // The page on screen stays until the next is here. That happens on the click, never
  // on the delay — the wait decides when to *say* a page is coming, and a page cleared
  // while the saying waits is the blink the wait was there to prevent.
  const stale = shown.pending && shown.held.length > 0;
  const drawn = stale ? shown.held : shown.rows;
  const drawnIndices = stale ? shown.heldIndices : shown.indices;
  const holding = busy && stale;
  const skeleton = busy && shown.pending && drawn.length === 0;
  // A search bound for the source is debounced; one that filters what is loaded is
  // not. The text is settled before it is debounced, so the space after a word is not
  // a second search, and ⏎ says "now".
  const [search, searchNow] = useDebounced(view.search.trim(), searchesLocally(block) ? 0 : 300);
  const { needed, want } = pullNeeded(block, { page: shown.page, search });
  const numeric = numericColumns(drawn, block.columns.length);

  useEffect(() => {
    if (needed) onPull(id, search, want);
  }, [needed, id, search, want, onPull]);

  // The list is read through a ref and the effect keyed on what is in it, so a repaint
  // that changes nothing about which cells are waiting doesn't ask again.
  const waiting = pendingCells(block, drawnIndices);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const waitingKey = cellsKey(waiting);

  useEffect(() => {
    if (waitingRef.current.length > 0) onCells(id, waitingRef.current);
  }, [waitingKey, id, onCells]);

  return (
    <div className="overflow-hidden rounded-lg border border-border" aria-busy={busy || undefined}>
      {/* One bar, above the rows. A pager under a fifty-row table is a control
          you have to go looking for, and on a canvas of several blocks it is
          hard to tell which table it belongs to. Everything in it is 28px,
          which is what a pointer wants and what a 12px glyph never was. */}
      {controls && (
        <div className="relative flex h-10 items-center gap-2 border-b border-border bg-card px-2">
          <div className="flex h-7 w-[200px] min-w-0 shrink items-center gap-1.5 rounded-md border border-input bg-background px-2 focus-within:border-ring">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              data-testid="canvas-table-search"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
              placeholder={searchesLocally(block) ? "Search rows" : "Search"}
              value={view.search}
              // A new search is a new set, so it is read from the first page.
              onChange={(event) => onView(id, { page: 0, search: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchNow();
              }}
            />
            {view.search !== "" && (
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
                onClick={() => onView(id, { page: 0, search: "" })}
              >
                <X size={13} />
              </button>
            )}
          </div>
          {/* A pull in flight, along the bottom edge of the toolbar: the one
              thing that moves, 2px of it, and it says nothing about how far
              along the fetch is because nothing knows. */}
          {busy && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-foreground/40 animate-sweep motion-reduce:animate-none" />
            </div>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span data-testid="canvas-table-summary" className="min-w-0 truncate tabular-nums text-muted-foreground @max-[520px]:hidden">
              {tableSummary(block, shown)}
            </span>
            {/* Two buttons joined into a pair: one target to aim at, and the
                gap between them can't be missed into. The loader is also where
                the click was — the pressed one holds a spinner in place of its
                chevron, rather than the toolbar reporting it somewhere else. */}
            <div className="flex shrink-0 overflow-hidden rounded-md border border-input">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center border-r border-input text-muted-foreground disabled:opacity-40 enabled:hover:bg-accent enabled:hover:text-accent-foreground"
                disabled={!shown.hasPrevious}
                aria-label="Previous page"
                onClick={() => {
                  setPressed("previous");
                  onView(id, { ...view, page: shown.page - 1 });
                }}
              >
                {busy && pressed === "previous" ? <Spinner className="size-3.5" /> : <ChevronLeft size={15} />}
              </button>
              <button
                type="button"
                data-testid="canvas-table-next"
                className="flex h-7 w-7 items-center justify-center text-muted-foreground disabled:opacity-40 enabled:hover:bg-accent enabled:hover:text-accent-foreground"
                disabled={!shown.hasNext || block.loading === true}
                aria-label="Next page"
                onClick={() => {
                  setPressed("next");
                  onView(id, { ...view, page: shown.page + 1 });
                }}
              >
                {busy && pressed === "next" ? <Spinner className="size-3.5" /> : <ChevronRight size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* The height of a full page, held for as long as the table can page, so
          a fetch, a short last page and a filtered result all leave the blocks
          below exactly where they were. */}
      <div className="relative flex flex-col" style={{ minHeight: bodyMinHeight(block, shown) }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted">
                {block.columns.map((column, index) => (
                  <th
                    key={index}
                    className={cn(
                      "h-7 whitespace-nowrap border-b border-border px-3 text-left font-medium uppercase text-muted-foreground",
                      numeric[index] && "text-right",
                    )}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            {/* Rows that are on their way out stop responding to the pointer:
                what is under it is the page you were reading, not the one you
                asked for. */}
            <tbody className={cn(holding && "pointer-events-none opacity-40")}>
              {skeleton
                ? Array.from({ length: shown.expected }, (_, rowIndex) => (
                    <tr key={rowIndex} className="last:[&>td]:border-b-0">
                      {block.columns.map((_, cellIndex) => (
                        <td key={cellIndex} className="h-[26px] border-b border-border/50 px-3">
                          <div className="h-2 rounded-full bg-foreground/10" style={{ width: SKELETON_WIDTHS[cellIndex % SKELETON_WIDTHS.length] }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : drawn.map((row, rowIndex) => (
                    // One row is one line: a cell that wrapped would break the 26px rhythm the whole
                    // grid is read down.
                    <tr key={rowIndex} className="last:[&>td]:border-b-0">
                      {row.map((cell, cellIndex) => (
                        <Canvas.TableCell
                          key={cellIndex}
                          cell={cell}
                          column={cellIndex}
                          numeric={numeric[cellIndex]}
                          status={cellStatus(block, drawnIndices[rowIndex], cellIndex)}
                          expired={block.expired === true}
                          onRetry={() => onCells(id, [{ row: drawnIndices[rowIndex], column: cellIndex, retry: true }])}
                        />
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {/* One slow shimmer across the whole set rather than one per bar: fifty
            bars each pulsing on their own is a light show, not a wait. */}
        {skeleton && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-7 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent animate-shimmer motion-reduce:animate-none" />
        )}
        {/* Nothing at all while a page is on its way and under the delay: a
            flash of loading state is worse than no state. */}
        {drawn.length === 0 && !skeleton && !shown.pending && (
          <div className="flex h-10 items-center gap-2 px-3 text-muted-foreground">
            {shown.filtered ? (
              <>
                <span className="min-w-0 truncate">No rows match “{view.search.trim()}”</span>
                <button
                  type="button"
                  className="shrink-0 underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                  onClick={() => onView(id, { page: 0, search: "" })}
                >
                  Clear search
                </button>
              </>
            ) : (
              "No rows yet…"
            )}
          </div>
        )}
      </div>
      {block.error !== undefined && (
        <div className="flex h-10 items-center gap-2 border-t border-border bg-destructive/10 px-3 text-destructive">
          <span className="min-w-0 flex-1 truncate">{block.error}</span>
          <button
            type="button"
            className="shrink-0 underline decoration-destructive/40 underline-offset-2 hover:text-foreground"
            onClick={() => onPull(id, search, shown.want)}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

interface TableCellProps {
  cell: string;
  column: number;
  numeric: boolean;
  status?: CellStatus;
  expired: boolean;
  onRetry: () => void;
}

/**
 * One cell, in one of three states. A waiting cell is the same bar a skeleton row
 * draws; a stopped one is a dim `—` with the message on hover, because a column of
 * numbers with `429 Too Many Requests` in it stops being a column.
 *
 * Two deliberate differences from the page loader: no shimmer (cells fill one at a
 * time, which is movement enough) and no delay (the bar arrives with the row rather
 * than replacing something, so there is nothing to flash).
 */
Canvas.TableCell = function ({ cell, column, numeric, status, expired, onRetry }: TableCellProps) {
  const className = cn("h-[26px] max-w-[48ch] truncate border-b border-border/50 px-3 text-foreground", numeric && "text-right");

  if (status === undefined) {
    return (
      <td className={className} title={cell.length > 48 ? cell : undefined}>
        {cell}
      </td>
    );
  }

  if (status.error === undefined) {
    // A run read back has lost the closure that would have filled this.
    if (expired) {
      return (
        <td className={cn(className, "text-muted-foreground")} title="Run to load">
          —
        </td>
      );
    }
    return (
      <td className={className}>
        <div className="h-2 rounded-full bg-foreground/10" style={{ width: SKELETON_WIDTHS[column % SKELETON_WIDTHS.length] }} />
      </td>
    );
  }

  // Asking again is only offered where it could work: a function can be called again,
  // a promise is finished whatever it settled as.
  const retry = status.retry === true && !expired;
  return (
    <td className={cn(className, "text-destructive")} title={retry ? `${status.error} · click to retry` : status.error}>
      {retry ? (
        <button type="button" className={cn("group/cell flex h-full w-full items-center gap-1", numeric && "justify-end")} aria-label="Retry" onClick={onRetry}>
          <span>—</span>
          <RotateCw size={11} className="opacity-0 transition-opacity group-hover/cell:opacity-100" />
        </button>
      ) : (
        "—"
      )}
    </td>
  );
};

// Only a search bound for a source needs the wait — restarting on every keystroke
// would fetch the same first page five times over.
function useDebounced<T>(value: T, delay: number): [T, () => void] {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (delay === 0) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return [delay === 0 ? value : settled, () => setSettled(value)];
}

/**
 * True once something has been true for this long, and false the moment it stops.
 * Under the delay the fetch is already back and what was drawn about it was a flicker.
 */
function useDelayed(active: boolean, delay: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && held;
}

interface AskProps {
  id: string;
  block: AskBlock;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
}

/**
 * The question the run is stopped on. A select is a list rather than a field, because
 * an answer that can only be one of five things should not be typeable as a sixth;
 * anything else refuses to submit until the answer is the kind that was asked for.
 * An answered one collapses to one row.
 */
Canvas.Ask = function ({ id, block, onAnswer, onCancelAsk }: AskProps) {
  const waiting = block.answer === undefined && !block.cancelled;

  if (!waiting) return <Canvas.AskSettled block={block} />;

  return (
    <div className="flex flex-col gap-2 rounded-r-md border-l-2 border-amber-500 bg-amber-500/10 py-2.5 pl-3 pr-3">
      <div className="whitespace-pre-wrap break-words text-amber-600 dark:text-amber-400">{block.question}</div>
      {block.answerType === "select" ? (
        <Canvas.AskChoices choices={block.choices ?? []} onAnswer={(answer) => onAnswer(id, answer)} onCancel={() => onCancelAsk(id)} />
      ) : (
        <Canvas.AskField answerType={block.answerType} onAnswer={(answer) => onAnswer(id, answer)} onCancel={() => onCancelAsk(id)} />
      )}
    </div>
  );
};

Canvas.AskSettled = function ({ block }: { block: AskBlock }) {
  return (
    <div data-testid="canvas-ask-settled" className="flex h-[34px] items-center gap-3 rounded-md border border-border bg-card px-3">
      {block.cancelled ? (
        <CircleX size={12} className="shrink-0 text-muted-foreground" />
      ) : (
        <CircleCheck size={12} className="shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 truncate text-muted-foreground" title={block.question}>
        {block.question}
      </span>
      {block.cancelled ? (
        <span className="ml-auto shrink-0 italic text-muted-foreground">Cancelled — the script stopped here</span>
      ) : (
        <span className="ml-auto min-w-0 max-w-[50%] truncate rounded bg-muted px-2 py-0.5 text-foreground" title={block.answer}>
          {block.answer}
        </span>
      )}
    </div>
  );
};

interface ApproveProps {
  id: string;
  block: ApproveBlock;
  fullScreen?: boolean;
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  onFullScreen?: () => void;
}

/**
 * The call the run is stopped in front of, holding the request it is about to send.
 *
 * The standing approval is in the menu, not on the row: the method it covers is the
 * whole question anyone hesitates over, and a name of any length costs the row
 * nothing there.
 *
 * No button takes focus. ⏎ approves this call only, Esc stops the script: a key
 * pressed at the wrong moment must not send the request this block exists to hold.
 */
Canvas.Approve = function ({ id, block, fullScreen, onDecide, onFullScreen }: ApproveProps) {
  const waiting = block.decision === undefined;
  const [expanded, setExpanded] = useState(false);
  // A settled block is a record: the payload collapses to its size, and View is the
  // way back to it.
  const [showRequest, setShowRequest] = useState(false);
  // Open, ⏎ belongs to the scope menu — otherwise the standing approval it is sitting
  // on would be settled as "this call" on the way past.
  const [scopeOpen, setScopeOpen] = useState(false);
  const size = formatBytes(new TextEncoder().encode(block.request).length);

  useEffect(() => {
    if (!waiting || scopeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A table's search box is still typeable while a call is held, and ⏎ in it means
      // "search now" — it must not be the thing that sends the request.
      if (isTyping(event.target)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onDecide(id, "approved");
      } else if (event.key === "Escape") {
        // Claimed here so full-screen doesn't take it: a run held in front of a call is what
        // Esc is about while one is on screen.
        event.preventDefault();
        onDecide(id, "rejected");
      }
    };
    // On the document rather than the window, so it is answered before full-screen's own
    // Esc whatever order the two effects happened to run in.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [waiting, scopeOpen, id, onDecide]);

  return (
    <div
      data-testid="canvas-approve"
      className={cn(
        "flex max-w-[620px] flex-col gap-2 rounded-r-md border-l-2 py-2.5 pl-3 pr-3",
        waiting ? "border-amber-500 bg-amber-500/10" : "border-border bg-card",
      )}
    >
      <div className={cn("flex items-center gap-2", waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        <ShieldQuestionMark size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{waiting ? `${block.method} is about to run` : block.method}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
          {size}
          {!waiting && (
            <>
              <span aria-hidden>·</span>
              <button type="button" data-testid="canvas-approve-view" className="hover:text-foreground" onClick={() => setShowRequest((shown) => !shown)}>
                View
              </button>
            </>
          )}
        </span>
      </div>
      {(waiting || showRequest) && (
        <Canvas.Payload
          text={block.request}
          expanded={expanded}
          onExpand={() => {
            setExpanded(true);
            onFullScreen?.();
          }}
        />
      )}
      {waiting ? (
        <div className="flex items-center gap-2">
          {/* One button with two halves: the main one approves what is in front
              of you, and the caret is where the standing approval names the
              method it would cover. */}
          <div className="flex items-stretch overflow-hidden rounded-md">
            <Button size="sm" className="h-8 rounded-none px-3" data-testid="canvas-approve-send" onClick={() => onDecide(id, "approved")}>
              Approve
            </Button>
            <DropdownMenu open={scopeOpen} onOpenChange={setScopeOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 rounded-none border-l border-black/20 px-1.5" aria-label="Approval scope" data-testid="canvas-approve-scope">
                  <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="w-[270px]">
                <DropdownMenuItem className="gap-2 font-mono text-xs" onSelect={() => onDecide(id, "approved")}>
                  <span className="min-w-0 flex-1 truncate">This call</span>
                  <span className="text-muted-foreground">⏎</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 font-mono text-xs" data-testid="canvas-approve-all" onSelect={() => onDecide(id, "all")}>
                  <span className="min-w-0 flex-1 truncate">Every {block.method} this run</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* A refusal, not a catastrophe: it must not out-weigh Approve. */}
          <Button size="sm" variant="secondary" className="h-8" data-testid="canvas-approve-stop" onClick={() => onDecide(id, "rejected")}>
            Stop
          </Button>
          <span className="ml-auto shrink-0 text-muted-foreground">⏎ · Esc</span>
        </div>
      ) : (
        <div className={cn(block.decision === "rejected" ? "italic text-muted-foreground" : "text-foreground")}>
          {block.decision === "rejected"
            ? "Not approved — the script stopped here"
            : block.standing
              ? `Approved — and every ${block.method} after it`
              : "Approved"}
        </div>
      )}
    </div>
  );
};

// The canvas's own keys are for the document, and a field on it is not the document.
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

interface PayloadProps {
  text: string;
  expanded: boolean;
  onExpand: () => void;
}

/**
 * A request, clipped to the height a decision can be made from. What is left out is
 * stated rather than scrolled past.
 */
Canvas.Payload = function ({ text, expanded, onExpand }: PayloadProps) {
  const lines = text.split("\n");
  const hidden = expanded ? 0 : Math.max(0, lines.length - APPROVE_CLIP_LINES);

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-background">
      <pre className={cn("overflow-x-auto px-2.5 py-2 leading-relaxed text-foreground", expanded && "max-h-[60vh] overflow-y-auto")}>
        {hidden > 0 ? lines.slice(0, APPROVE_CLIP_LINES).join("\n") : text}
      </pre>
      {hidden > 0 && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-[22px] h-[26px] bg-gradient-to-b from-transparent to-background" />
          <button
            type="button"
            data-testid="canvas-approve-expand"
            className="flex w-full items-center gap-1.5 border-t border-border px-2.5 py-1 text-left text-muted-foreground hover:text-foreground"
            onClick={onExpand}
          >
            <span>
              {hidden} more {hidden === 1 ? "line" : "lines"}
            </span>
            <span aria-hidden>·</span>
            <span>Expand</span>
          </button>
        </>
      )}
    </div>
  );
};

interface AskFieldProps {
  answerType: AskAnswerType;
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}

// A typed answer is checked here rather than in the script, which is the whole point
// of asking for one: the problem is stated under the field while the person who
// typed it is still looking at it.
Canvas.AskField = function ({ answerType, onAnswer, onCancel }: AskFieldProps) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const said = answerProblem(answerType, value);
    if (said) {
      setProblem(said);
      return;
    }
    onAnswer(normalizeAnswer(answerType, value));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className={cn("flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5", problem ? "border-destructive" : "border-amber-500")}>
        <input
          ref={inputRef}
          data-testid="canvas-ask-input"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={answerPlaceholder(answerType)}
          inputMode={answerType === "int" ? "numeric" : undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              // A focused field takes Esc before full-screen does; the second one, with nothing
              // left wanting it, is the way out.
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <span className="shrink-0 text-muted-foreground">⏎</span>
      </div>
      {problem && <div className="text-destructive">{problem}</div>}
    </div>
  );
};

interface AskChoicesProps {
  choices: string[];
  onAnswer: (answer: string) => void;
  onCancel: () => void;
}

// A listbox rather than a Select popup: the canvas has the room, and a question the
// run is parked on should not need a click to read.
Canvas.AskChoices = function ({ choices, onAnswer, onCancel }: AskChoicesProps) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      data-testid="canvas-ask-choices"
      className="flex flex-col gap-1 outline-none"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : choices.length - 1;
          setActive((index) => (index + step) % choices.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (choices[active] !== undefined) onAnswer(choices[active]);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now();
          const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + event.key;
          if (text.trim() === "") return;
          typed.current = { text, at: now };
          const index = typeaheadIndex(choices, text, active);
          if (index === undefined) return;
          event.preventDefault();
          setActive(index);
        }
      }}
    >
      {choices.map((choice, index) => (
        <button
          key={index}
          ref={index === active ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={index === active}
          data-testid="canvas-ask-choice"
          className={cn(
            "flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left",
            index === active ? "border-amber-500" : "border-border hover:border-amber-500/50",
          )}
          onMouseEnter={() => setActive(index)}
          onClick={() => onAnswer(choice)}
        >
          <span className="min-w-0 flex-1 break-words text-foreground">{choice}</span>
          {index === active && <span className="shrink-0 text-muted-foreground">⏎</span>}
        </button>
      ))}
    </div>
  );
};

/**
 * A failure nothing was drawn after — the canvas does not interrupt itself for one
 * the script reported in a better place. Stated once per method.
 */
Canvas.Failure = function ({ failure, onOpen }: { failure: FailureNotice; onOpen: () => void }) {
  const said = [failure.code, failure.message].filter(Boolean).join(" ");

  return (
    <div
      data-testid="canvas-failure"
      className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-destructive"
    >
      <AlertTriangle size={12} className="shrink-0" />
      <span className="min-w-0 truncate">
        {failure.count > 1 && `${failure.count} × `}
        {failure.method} failed{said && ` — ${said}`}
      </span>
      <button type="button" className="ml-auto shrink-0 whitespace-nowrap hover:text-foreground" onClick={onOpen}>
        Open in log
      </button>
    </div>
  );
};

// A script that threw is the run's own failure rather than any one call's.
Canvas.Logs = function ({ logs }: { logs: Log[] }) {
  const failed = logs.some((log) => log.level === LogLevel.LEVEL_ERROR);
  return (
    <div
      className={cn("flex flex-col gap-1 rounded-r-md border-l-2 py-2.5 pl-3 pr-3", failed ? "border-destructive bg-destructive/10" : "border-border bg-card")}
    >
      {logs.map((log, index) => (
        <div key={index} className={cn("whitespace-pre-wrap break-words", failed ? "text-destructive" : "text-foreground")}>
          {log.message.trim()}
        </div>
      ))}
    </div>
  );
};
