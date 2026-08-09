import { ChevronLeft, ChevronRight, Search, ShieldQuestionMark } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { answerPlaceholder, answerProblem, AskAnswerType, normalizeAnswer } from "./ask";
import { ApproveBlock, AskBlock, Block, CodeBlock, TableBlock, TextBlock } from "./blocks";
import { CanvasEntry, foldCalls, groupDuration, groupFailures, groupKeyLabel } from "./callGroups";
import { cn } from "./cn";
import { Button } from "./components/button";
import { Spinner } from "./components/spinner";
import { isCallInFlight, MethodCall } from "./kaja";
import { hasControls, NO_TABLE_VIEW, pullNeeded, searchesLocally, tableSummary, tableWindow, TableView } from "./tableView";
import { loopKey } from "./loopKey";
import { barFraction, callErrorCode, dotClass, formatDuration } from "./callFormat";
import { ConsoleItem, itemStatus, RunGroup, slowestOf, worstStatus } from "./runs";
import { Log, LogLevel } from "./server/api";

// The strip of ticks a folded group draws, and the shape of one tick. The whole
// strip is budgeted rather than each tick, so ten calls read as a duration
// profile and thirty read as a count — a tick too thin to hit is worse than one
// that admits it has nothing left to say.
const STRIP_WIDTH = 240;
const TICK_GAP = 2;
const TICK_MIN_WIDTH = 5;
const TICK_MAX_WIDTH = 26;
// Past this the ticks are drawn for the first calls only and the row says how
// many it left out, on the same rule as the log's tail bar.
const MAX_TICKS = 32;

interface CanvasProps {
  group: RunGroup;
  // Which call the log is pointing at, so stepping through it is visible here
  // too. The canvas → list arrow is one click; this is the way back.
  selectedItemId?: string;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // One prop for both buttons of an approve block, because there is one decision
  // to make and the block records it under this name.
  onDecide: (blockId: string, decision: "approved" | "rejected") => void;
  // Clicking a call card takes you to that call's row in the log, which is where
  // its complete record is. The card can stay minimal because of it.
  onSelectCall: (itemId: string) => void;
  // Where each table is pointed. It is view state rather than something the run
  // drew, so it is held above the canvas and survives switching views.
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

/**
 * What the run drew, in emission order. Calls appear as one-line cards where the
 * story needs them — they can stay minimal because the complete record is one
 * click away in the list — and a run of consecutive calls to one method folds
 * into a single row, which is the whole reason the canvas is not the log.
 */
export function Canvas({ group, selectedItemId, onAnswer, onCancelAsk, onDecide, onSelectCall, tableViews, onTableView, onTablePull }: CanvasProps) {
  const entries = useMemo(() => foldCalls(group.items), [group.items]);

  if (group.run.payloadsExpired) {
    return <Canvas.Notice>Canvas no longer kept — run to see it live</Canvas.Notice>;
  }
  if (group.items.length === 0) {
    return <Canvas.Notice>{group.inFlight ? "Waiting for the first call…" : "This run drew nothing."}</Canvas.Notice>;
  }

  return (
    <div className={cn("@container flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-mono text-xs", group.run.stale && "opacity-70")}>
      {entries.map((entry) => (
        // Blocks keep their full height and the canvas scrolls. Without this a
        // long table is squeezed to a couple of rows to make the run fit — the
        // rows are still there, which is what makes it look like a rendering
        // bug rather than a layout one.
        <div key={entry.id} className="shrink-0">
          <Canvas.Entry
            entry={entry}
            selectedItemId={selectedItemId}
            onAnswer={onAnswer}
            onCancelAsk={onCancelAsk}
            onDecide={onDecide}
            onSelectCall={onSelectCall}
            tableViews={tableViews}
            onTableView={onTableView}
            onTablePull={onTablePull}
          />
        </div>
      ))}
    </div>
  );
}

Canvas.Notice = function ({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-muted-foreground">{children}</div>;
};

interface EntryProps {
  entry: CanvasEntry;
  selectedItemId?: string;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // One prop for both buttons of an approve block, because there is one decision
  // to make and the block records it under this name.
  onDecide: (blockId: string, decision: "approved" | "rejected") => void;
  onSelectCall: (itemId: string) => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

Canvas.Entry = function ({ entry, selectedItemId, onAnswer, onCancelAsk, onDecide, onSelectCall, tableViews, onTableView, onTablePull }: EntryProps) {
  if (entry.kind === "calls") {
    return <Canvas.CallGroup name={entry.name} items={entry.items} selectedItemId={selectedItemId} onSelectCall={onSelectCall} />;
  }

  const item = entry.item;
  if (item.call) return <Canvas.CallCard call={item.call} selected={item.id === selectedItemId} onSelect={() => onSelectCall(item.id)} />;
  if (item.logs) return <Canvas.Logs logs={item.logs} />;
  if (!item.block) return null;
  return (
    <Canvas.Block
      id={item.id}
      block={item.block}
      onAnswer={onAnswer}
      onCancelAsk={onCancelAsk}
      onDecide={onDecide}
      tableViews={tableViews}
      onTableView={onTableView}
      onTablePull={onTablePull}
    />
  );
};

interface BlockProps {
  id: string;
  block: Block;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // One prop for both buttons of an approve block, because there is one decision
  // to make and the block records it under this name.
  onDecide: (blockId: string, decision: "approved" | "rejected") => void;
  tableViews: { [blockId: string]: TableView };
  onTableView: (blockId: string, view: TableView) => void;
  onTablePull: (blockId: string, search: string, want: number) => void;
}

Canvas.Block = function ({ id, block, onAnswer, onCancelAsk, onDecide, tableViews, onTableView, onTablePull }: BlockProps) {
  switch (block.kind) {
    case "text":
      return <Canvas.Text block={block} />;
    case "code":
      return <Canvas.Code block={block} />;
    case "table":
      return <Canvas.Table id={id} block={block} view={tableViews[id] ?? NO_TABLE_VIEW} onView={onTableView} onPull={onTablePull} />;
    case "ask":
      return <Canvas.Ask id={id} block={block} onAnswer={onAnswer} onCancelAsk={onCancelAsk} />;
    case "approve":
      return <Canvas.Approve id={id} block={block} onDecide={onDecide} />;
  }
};

Canvas.Text = function ({ block }: { block: TextBlock }) {
  return <div className="whitespace-pre-wrap break-words leading-relaxed text-foreground">{block.text}</div>;
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
 * A wide table scrolls inside itself; the canvas never scrolls sideways as a
 * whole, because everything above and below it would move with it.
 *
 * The pager is over rows rather than requests: paging past what is loaded is
 * what pulls the source, and nothing else does. A search that the source takes
 * restarts it; one it doesn't filters the rows already here, and says so — a
 * local filter that fetched would pull an API dry to find three rows.
 */
Canvas.Table = function ({ id, block, view, onView, onPull }: TableProps) {
  const shown = tableWindow(block, view);
  const controls = hasControls(block);
  // A search bound for the source is debounced; one that filters what is loaded
  // is not, because it costs nothing and lagging under the keystrokes is worse.
  // The text is settled before it is debounced, so the space after a word is not
  // a second search — and ⏎ says "now", which is what the wait is for.
  const [search, searchNow] = useDebounced(view.search.trim(), searchesLocally(block) ? 0 : 300);
  const { needed, want } = pullNeeded(block, { page: shown.page, search });

  useEffect(() => {
    if (needed) onPull(id, search, want);
  }, [needed, id, search, want, onPull]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* One bar, above the rows. A pager under a fifty-row table is a control
          you have to go looking for, and on a canvas of several blocks it is
          hard to tell which table it belongs to. */}
      {controls && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Search size={12} className="shrink-0" />
          <input
            data-testid="canvas-table-search"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={searchesLocally(block) ? "Search loaded rows…" : "Search…"}
            value={view.search}
            // A new search is a new set, so it is read from the first page.
            onChange={(event) => onView(id, { page: 0, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") searchNow();
            }}
          />
          {block.loading && <Spinner className="size-3 shrink-0" />}
          <span data-testid="canvas-table-summary" className="shrink-0 truncate tabular-nums @max-[420px]:hidden">
            {tableSummary(block, shown)}
          </span>
          <button
            type="button"
            className="shrink-0 disabled:opacity-40 enabled:hover:text-foreground"
            disabled={!shown.hasPrevious}
            aria-label="Previous page"
            onClick={() => onView(id, { ...view, page: shown.page - 1 })}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            type="button"
            data-testid="canvas-table-next"
            className="shrink-0 disabled:opacity-40 enabled:hover:text-foreground"
            disabled={!shown.hasNext || block.loading === true}
            aria-label="Next page"
            onClick={() => onView(id, { ...view, page: shown.page + 1 })}
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th
                  key={index}
                  className="whitespace-nowrap border-b border-border py-1 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-b border-border/50 py-1 pr-4 align-top text-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.rows.length === 0 && (
          <div className="py-1.5 text-muted-foreground">{block.loading ? "Loading…" : shown.filtered ? "No rows match." : "No rows yet…"}</div>
        )}
      </div>
      {block.error !== undefined && (
        <div className="flex items-center gap-2 text-destructive">
          <span className="min-w-0 flex-1 truncate">{block.error}</span>
          <button type="button" className="shrink-0 hover:text-foreground" onClick={() => onPull(id, search, shown.want)}>
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
 */
Canvas.Ask = function ({ id, block, onAnswer, onCancelAsk }: AskProps) {
  const waiting = block.answer === undefined && !block.cancelled;

  return (
    <div className={cn("flex flex-col gap-2 rounded-r-md border-l-2 py-2.5 pl-3 pr-3", waiting ? "border-amber-500 bg-amber-500/10" : "border-border bg-card")}>
      <div className={cn("whitespace-pre-wrap break-words", waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{block.question}</div>
      {!waiting ? (
        <div className={cn("break-words", block.cancelled ? "italic text-muted-foreground" : "text-foreground")}>
          {block.cancelled ? "Cancelled" : block.answer}
        </div>
      ) : block.answerType === "select" ? (
        <Canvas.AskChoices choices={block.choices ?? []} onAnswer={(answer) => onAnswer(id, answer)} onCancel={() => onCancelAsk(id)} />
      ) : (
        <Canvas.AskField answerType={block.answerType} onAnswer={(answer) => onAnswer(id, answer)} onCancel={() => onCancelAsk(id)} />
      )}
    </div>
  );
};

interface ApproveProps {
  id: string;
  block: ApproveBlock;
  onDecide: (blockId: string, decision: "approved" | "rejected") => void;
}

/**
 * The call the run is stopped in front of, drawn where it would have happened
 * and holding the request it is about to send — a call is worth approving
 * because of what is in it, so the payload is the block rather than a click
 * away. It wears the same amber as an ask, since it parks the run the same way.
 *
 * Neither button takes focus. An ask focuses its input, which costs nothing;
 * here Enter would send the request, and a key pressed at the wrong moment is
 * exactly what this block exists to prevent.
 */
Canvas.Approve = function ({ id, block, onDecide }: ApproveProps) {
  const waiting = block.decision === undefined;

  return (
    <div
      data-testid="canvas-approve"
      className={cn("flex flex-col gap-2 rounded-r-md border-l-2 py-2.5 pl-3 pr-3", waiting ? "border-amber-500 bg-amber-500/10" : "border-border bg-card")}
    >
      <div className={cn("flex items-center gap-2", waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        <ShieldQuestionMark size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{block.method}</span>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background px-2.5 py-2 leading-relaxed text-foreground">{block.request}</pre>
      {waiting ? (
        <div className="flex items-center gap-2">
          <Button size="sm" data-testid="canvas-approve-send" onClick={() => onDecide(id, "approved")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" data-testid="canvas-approve-stop" onClick={() => onDecide(id, "rejected")}>
            Stop
          </Button>
        </div>
      ) : (
        <div className={cn(block.decision === "rejected" ? "italic text-muted-foreground" : "text-foreground")}>
          {block.decision === "approved" ? "Approved" : "Not approved — the script stopped here"}
        </div>
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

// A call on the canvas is a one-line card: enough to place it in the story, and
// a click away from the row that holds everything about it.
Canvas.CallCard = function ({ call, selected, onSelect }: { call: MethodCall; selected: boolean; onSelect: () => void }) {
  const status = call.error ? "error" : call.output === undefined && call.streamOutputs === undefined ? "pending" : "success";
  const code = callErrorCode(call);

  return (
    <button
      type="button"
      data-testid="canvas-call-card"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border bg-card px-2.5 py-1.5 text-left hover:bg-accent",
        selected ? "border-muted-foreground/40" : "border-border",
      )}
      onClick={onSelect}
    >
      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status === "error" ? "bg-red-500" : status === "pending" ? "bg-muted-foreground" : "bg-emerald-500")}
      />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {call.service.name}.{call.method.name}
      </span>
      {code && <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">{code}</span>}
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(call.durationMs)}</span>
    </button>
  );
};

interface CallGroupProps {
  name: string;
  items: ConsoleItem[];
  selectedItemId?: string;
  onSelectCall: (itemId: string) => void;
}

/**
 * A loop, as one row. Ten calls to one method are ten identical cards saying the
 * same name ten times, which is the log's job and the log does it better — so
 * the canvas says the name once, how many there were, and what told them apart.
 *
 * The ticks are what keep it a canvas rather than a summary: one per call, drawn
 * against the slowest in the group, so which iteration was slow is a shape here
 * rather than a trip to the list — and each one is its own way into that call's
 * complete record.
 */
Canvas.CallGroup = function ({ name, items, selectedItemId, onSelectCall }: CallGroupProps) {
  const status = worstStatus(items);
  const inFlight = items.some((item) => item.call !== undefined && isCallInFlight(item.call));
  const slowest = slowestOf(items);
  const failures = groupFailures(items);
  const keys = groupKeyLabel(items);
  const duration = formatDuration(groupDuration(items));
  const shown = items.slice(0, MAX_TICKS);
  const hidden = items.length - shown.length;
  // The strip has the budget, not the tick: past a certain density every tick is
  // the minimum width and the strip stops claiming to measure anything.
  const slot = Math.max(TICK_MIN_WIDTH + TICK_GAP, Math.min(TICK_MAX_WIDTH + TICK_GAP, Math.floor(STRIP_WIDTH / shown.length)));

  return (
    <div data-testid="canvas-call-group" className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card pr-2.5">
      {/* The name is the way in for the whole group; the ticks are the way in
          for one call of it. Below the width the strip needs, the name is the
          only one left — the same degradation the log's columns make. */}
      <button
        type="button"
        data-testid="canvas-group-label"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-md py-1.5 pl-2.5 text-left hover:bg-accent"
        onClick={() => onSelectCall(items[0].id)}
      >
        <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
        {inFlight ? <Spinner className="size-3" /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(status))} />}
        <span className="shrink-0 truncate text-foreground">{name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">×{items.length}</span>
        {keys && <span className="min-w-0 truncate text-muted-foreground/80 @max-[420px]:hidden">{keys}</span>}
      </button>
      <div className="flex shrink-0 items-center @max-[520px]:hidden" style={{ gap: TICK_GAP }}>
        {shown.map((item, index) => (
          <Canvas.Tick
            key={item.id}
            item={item}
            name={name}
            index={index}
            total={items.length}
            slowest={slowest}
            maxWidth={slot - TICK_GAP}
            selected={item.id === selectedItemId}
            onSelect={() => onSelectCall(item.id)}
          />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="pl-1 tabular-nums text-muted-foreground hover:text-foreground"
            title={`${hidden} more not drawn — open the ${shown.length + 1}${nth(shown.length + 1)} in the list`}
            onClick={() => onSelectCall(items[shown.length].id)}
          >
            +{hidden}
          </button>
        )}
      </div>
      {failures > 0 && <span className="shrink-0 text-destructive">{failures === 1 ? "1 error" : `${failures} errors`}</span>}
      <span className="w-[9ch] shrink-0 truncate text-right tabular-nums text-muted-foreground">{duration}</span>
    </div>
  );
};

interface TickProps {
  item: ConsoleItem;
  name: string;
  index: number;
  total: number;
  slowest?: number;
  maxWidth: number;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One call of a folded group: as long as it took, coloured only when it failed —
 * the group's dot already says how the group went, so the strip is free to be a
 * measurement. A call still in flight has no length yet and gets the minimum.
 */
Canvas.Tick = function ({ item, name, index, total, slowest, maxWidth, selected, onSelect }: TickProps) {
  const status = itemStatus(item);
  const duration = item.call?.durationMs;
  const fraction = barFraction(duration, slowest);
  const width = fraction === undefined ? TICK_MIN_WIDTH : Math.round(TICK_MIN_WIDTH + fraction * Math.max(0, maxWidth - TICK_MIN_WIDTH));
  const key = loopKey(item.call?.input);
  const detail = [key, formatDuration(duration)].filter((part) => part !== undefined).join(" · ");

  return (
    <button
      type="button"
      data-testid="canvas-call-tick"
      className="group/tick shrink-0 py-1"
      style={{ width }}
      title={detail}
      aria-label={`${name}, call ${index + 1} of ${total}${detail ? `, ${detail}` : ""}`}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <span
        className={cn(
          "block h-[8px] rounded-[2px]",
          status === "error" ? "bg-destructive/60" : status === "success" ? "bg-muted-foreground/35" : "bg-muted-foreground/15",
          selected && "bg-foreground/70",
          "group-hover/tick:bg-foreground/50",
        )}
      />
    </button>
  );
};

function nth(position: number): string {
  if (position % 100 >= 11 && position % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[position % 10] ?? "th";
}

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
