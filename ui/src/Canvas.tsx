import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleX, Search, ShieldQuestionMark, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { answerPlaceholder, answerProblem, AskAnswerType, normalizeAnswer } from "./ask";
import { ApproveBlock, ApproveGesture, AskBlock, Block, CodeBlock, TableBlock, TextBlock } from "./blocks";
import { formatBytes, formatDuration } from "./callFormat";
import { cn } from "./cn";
import { Button } from "./components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { Spinner } from "./components/spinner";
import { bodyMinHeight, hasControls, NO_TABLE_VIEW, numericColumns, pullNeeded, searchesLocally, tableSummary, tableWindow, TableView } from "./tableView";
import { ConsoleItem, FailureNotice, RunGroup } from "./runs";
import { barHeight, BAR_MAX_HEIGHT, slotsFor, SLOT_WIDTH, StripSlot, TICK_HEIGHT, TICK_WIDTH } from "./runStrip";
import { Log, LogLevel } from "./server/api";

/**
 * What the counts and the label at the end of the strip need before the marks
 * get any room. The strip is what is left of the row after them, which is what
 * "available width" means: the same run draws ticks in a wide panel and buckets
 * in a narrow one.
 */
const STRIP_RESERVE = 160;

// How much of a held request is shown before the block starts claiming room the
// document needs for everything after it. Past this it fades out and says how
// much it kept back — a decision is never made from a payload you had to leave
// the screen to read, so Expand is beside the number.
const APPROVE_CLIP_LINES = 12;

/**
 * How long a table's pull has to be taking before anything is drawn about it. A
 * page off a local server is back inside a frame or two, and a dim that flashes
 * for 40ms reads as a glitch rather than as progress.
 */
const TABLE_LOADING_DELAY_MS = 150;

/**
 * Skeleton bar widths, by column index. Fixed rather than random: widths that
 * re-roll on every render look like activity that isn't there, and a column of
 * bars that all end in the same place reads as a column.
 */
const SKELETON_WIDTHS = ["58%", "76%", "44%", "66%", "52%", "70%"];

interface CanvasProps {
  group: RunGroup;
  // Whether this is the full-screen canvas rather than the console's third of
  // the window. It is a size and not a mode: everything below reads it only to
  // decide how much air a block is given.
  fullScreen?: boolean;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // One prop for every button of an approve block, because there is one decision
  // to make and the block records it under this name.
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  // Where a failure the script never mentioned leads: its row in the log, which
  // is where the complete record of every call is.
  onSelectCall: (itemId: string) => void;
  // Expanding a held request takes the window, so a decision is never made from
  // a payload you had to leave the screen to read.
  onFullScreen?: () => void;
  // Kept across entering and leaving full-screen, so the way back lands where
  // you left rather than at the top of the document.
  scrollRef?: React.MutableRefObject<number>;
  // Where each table is pointed. It is view state rather than something the run
  // drew, so it is held above the canvas and survives switching views.
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

/**
 * What the run drew, in emission order, and nothing else. A call is not a block
 * and is not drawn as one — the strip above states every call the run made, so
 * the document is the text, the tables and the questions, with the air between
 * them that the call rows used to take.
 */
export function Canvas({
  group,
  fullScreen,
  onAnswer,
  onCancelAsk,
  onDecide,
  onSelectCall,
  onFullScreen,
  scrollRef,
  tableViews,
  onTableView,
  onTablePull,
}: CanvasProps) {
  const drawn = group.drawn;
  const unreported = group.unreported;
  const scroller = useRef<HTMLDivElement>(null);

  // Entering and leaving full-screen is the same document in another container,
  // so the offset is carried rather than the element.
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
        // Blocks keep their full height and the canvas scrolls. Without this a
        // long table is squeezed to a couple of rows to make the run fit — the
        // rows are still there, which is what makes it look like a rendering
        // bug rather than a layout one.
        <div key={item.id} className="shrink-0">
          <Canvas.Entry
            item={item}
            fullScreen={fullScreen}
            onAnswer={onAnswer}
            onCancelAsk={onCancelAsk}
            onDecide={onDecide}
            onFullScreen={onFullScreen}
            tableViews={tableViews}
            onTableView={onTableView}
            onTablePull={onTablePull}
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
 * The run's calls, as one 28px row under the console header — the only place the
 * canvas states them now that a call is not a block.
 *
 * The mode is decided by the room, not by a count: one mark per call for exactly
 * as long as a mark can still be a call, and buckets past that. So the same run
 * is a list of ticks in a wide panel and a profile in a narrow one, and neither
 * is claiming to draw something it isn't.
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

// What a mark says it is. One call names itself; a bucket says how many it holds
// and how slow the slowest of them was, which is the whole reason it has a
// height.
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
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

Canvas.Entry = function ({ item, fullScreen, onAnswer, onCancelAsk, onDecide, onFullScreen, tableViews, onTableView, onTablePull }: EntryProps) {
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
      tableViews={tableViews}
      onTableView={onTableView}
      onTablePull={onTablePull}
    />
  );
};

interface BlockProps {
  id: string;
  block: Block;
  fullScreen?: boolean;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // One prop for every button of an approve block, because there is one decision
  // to make and the block records it under this name.
  onDecide: (blockId: string, gesture: ApproveGesture) => void;
  onFullScreen?: () => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

Canvas.Block = function ({ id, block, fullScreen, onAnswer, onCancelAsk, onDecide, onFullScreen, tableViews, onTableView, onTablePull }: BlockProps) {
  switch (block.kind) {
    case "text":
      return <Canvas.Text block={block} fullScreen={fullScreen} />;
    case "code":
      return <Canvas.Code block={block} />;
    case "table":
      return <Canvas.Table id={id} block={block} view={tableViews[id] ?? NO_TABLE_VIEW} onView={onTableView} onPull={onTablePull} />;
    case "ask":
      return <Canvas.Ask id={id} block={block} onAnswer={onAnswer} onCancelAsk={onCancelAsk} />;
    case "approve":
      return <Canvas.Approve id={id} block={block} fullScreen={fullScreen} onDecide={onDecide} onFullScreen={onFullScreen} />;
  }
};

// Prose is measured rather than left to the container: a table wants the whole
// width and a paragraph wants a line you can come back from.
Canvas.Text = function ({ block, fullScreen }: { block: TextBlock; fullScreen?: boolean }) {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-foreground" style={{ maxWidth: fullScreen ? "72ch" : "60ch" }}>
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
}

/**
 * The one block that is wider than the text around it, so it is the one block
 * with a frame: a card with its own toolbar, a header band under it, and the
 * canvas's 16px gap doing the rest. Without the frame the header row reads as
 * another line of the paragraph above it.
 *
 * A wide table scrolls inside itself; the canvas never scrolls sideways as a
 * whole, because everything above and below it would move with it.
 *
 * The pager is over rows rather than requests: paging past what is loaded is
 * what pulls the source, and nothing else does. A search that the source takes
 * restarts it; one it doesn't filters the rows already here, and says so — a
 * local filter that fetched would pull an API dry to find three rows.
 *
 * **Paging moves nothing.** The frame keeps the height of a full page while the
 * table can still page, so the blocks below it stay where they are; the page
 * that was on screen stays too, dimmed, until the next one is here. Only a first
 * draw has nothing to dim, and that is what the skeleton rows are for.
 */
Canvas.Table = function ({ id, block, view, onView, onPull }: TableProps) {
  const shown = tableWindow(block, view);
  const controls = hasControls(block);
  const busy = useDelayed(block.loading === true, TABLE_LOADING_DELAY_MS);
  // Which chevron was pressed, so the spinner is where the click was. It is the
  // press that is remembered rather than the direction of the move: the page can
  // be clamped, and a pull can start without either button being touched.
  const [pressed, setPressed] = useState<"previous" | "next" | undefined>(undefined);
  // Forgotten once the page it asked for is here — and not a moment before: the
  // pull it started is one effect away, so a press cleared on "not loading yet"
  // is a press cleared between the click and the fetch it caused.
  if (pressed !== undefined && block.loading !== true && !shown.pending) setPressed(undefined);

  // Nothing is destroyed and nothing resizes: the old page holds its place at
  // reduced opacity until the new one is here.
  const holding = busy && shown.pending && shown.held.length > 0;
  const drawn = holding ? shown.held : shown.rows;
  const skeleton = busy && shown.pending && drawn.length === 0;
  // A search bound for the source is debounced; one that filters what is loaded
  // is not, because it costs nothing and lagging under the keystrokes is worse.
  // The text is settled before it is debounced, so the space after a word is not
  // a second search — and ⏎ says "now", which is what the wait is for.
  const [search, searchNow] = useDebounced(view.search.trim(), searchesLocally(block) ? 0 : 300);
  const { needed, want } = pullNeeded(block, { page: shown.page, search });
  const numeric = numericColumns(drawn, block.columns.length);

  useEffect(() => {
    if (needed) onPull(id, search, want);
  }, [needed, id, search, want, onPull]);

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
                    // One row is one line: a cell that wrapped would break the
                    // 26px rhythm the whole grid is read down.
                    <tr key={rowIndex} className="last:[&>td]:border-b-0">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cn("h-[26px] max-w-[48ch] truncate border-b border-border/50 px-3 text-foreground", numeric[cellIndex] && "text-right")}
                          title={cell.length > 48 ? cell : undefined}
                        >
                          {cell}
                        </td>
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

// A value that settles, and the way to settle it now. Only a search bound for a
// source needs the wait — restarting on every keystroke would fetch the same
// first page five times over — and anyone who is done typing shouldn't serve it.
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
 * True once something has been true for this long, and false the moment it
 * stops. A loading state is worth drawing only if it will be read: under the
 * delay the fetch is already back, and what was drawn about it was a flicker.
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
 * The question the run is stopped on. Amber is Kaja's "needs you" colour, and it
 * is the whole signal here: the block, the Canvas tab's dot and the run pill all
 * carry it, so a parked run is findable from wherever you happen to be.
 *
 * What is drawn under the question is what the script asked for. A select is a
 * list rather than a field, because an answer that can only be one of five
 * things should not be typeable as a sixth; anything else is a field that
 * refuses to submit until the answer is the kind of thing that was asked for.
 *
 * An answered one is a record and collapses to one row: ten answered asks were
 * ten cards saying nothing the row doesn't.
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

// The question dimmed and truncating, the answer as a chip beside it. A long
// answer truncates in the chip and titles in full.
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
 * The call the run is stopped in front of, drawn where it would have happened
 * and holding the request it is about to send — a call is worth approving
 * because of what is in it, so the payload is the block rather than a click
 * away. It wears the same amber as an ask, since it parks the run the same way.
 *
 * **The standing approval is in the menu, not on the row.** The method it covers
 * is the whole question anyone hesitates over before pressing it, and a name of
 * any length in the caret's menu costs the row nothing.
 *
 * No button takes focus. ⏎ approves this call and only this call; the standing
 * approval always costs a deliberate gesture, and Esc stops the script. A key
 * pressed at the wrong moment must not send the request the block exists to
 * hold.
 */
Canvas.Approve = function ({ id, block, fullScreen, onDecide, onFullScreen }: ApproveProps) {
  const waiting = block.decision === undefined;
  const [expanded, setExpanded] = useState(false);
  // A settled block is a record: the payload collapses to its size, and View is
  // the way back to it for the one that is worth re-reading.
  const [showRequest, setShowRequest] = useState(false);
  // Open, ⏎ belongs to the scope menu — otherwise the standing approval it is
  // sitting on would be settled as "this call" on the way past.
  const [scopeOpen, setScopeOpen] = useState(false);
  const size = formatBytes(new TextEncoder().encode(block.request).length);

  useEffect(() => {
    if (!waiting || scopeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A table's search box is still typeable while a call is held, and ⏎ in it
      // means "search now" — it must not be the thing that sends the request.
      if (isTyping(event.target)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        onDecide(id, "approved");
      } else if (event.key === "Escape") {
        // Claimed here so full-screen doesn't take it: a run held in front of a
        // call is what Esc is about while one is on screen.
        event.preventDefault();
        onDecide(id, "rejected");
      }
    };
    // On the document rather than the window, so it is answered before
    // full-screen's own Esc whatever order the two effects happened to run in.
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
            // The room is the point: a request worth reading in full is worth
            // the window, and the decision stays under it either way.
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

// Whether the keystroke belongs to something being typed in. The canvas's own
// keys are for the document, and a field on it is not the document.
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
 * A request, clipped to the height a decision can be made from. What is left out
 * is stated rather than scrolled past: a payload that quietly continues below
 * the fold is one nobody reads to the end of.
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

// A typed answer is checked here rather than in the script, which is the whole
// point of asking for one: the problem is stated under the field, while the
// person who typed it is still looking at it.
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
              // A focused field takes Esc before full-screen does; the second
              // one, with nothing left wanting it, is the way out.
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

// The options, as a list you walk with the arrow keys. It is a listbox rather
// than a Select popup because the canvas has the room and a question the run is
// parked on should not need a click to read.
Canvas.AskChoices = function ({ choices, onAnswer, onCancel }: AskChoicesProps) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

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
        }
      }}
    >
      {choices.map((choice, index) => (
        <button
          key={index}
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
 * A failure nothing was drawn after. The canvas does not interrupt itself for a
 * call whose failure the script reported in a better place — a table with a
 * result column — so what is left is the one the run said nothing about, stated
 * once per method with the way into the complete record beside it.
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

// A script that threw is the run's own failure rather than any one call's, so it
// lands on the canvas as the last thing that happened.
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
