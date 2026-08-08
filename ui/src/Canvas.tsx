import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AskBlock, Block, CodeBlock, TableBlock, TextBlock } from "./blocks";
import { cn } from "./cn";
import { MethodCall } from "./kaja";
import { callErrorCode, formatDuration } from "./callFormat";
import { ConsoleItem, RunGroup } from "./runs";
import { Log, LogLevel } from "./server/api";

interface CanvasProps {
  group: RunGroup;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  // Clicking a call card takes you to that call's row in the log, which is where
  // its complete record is. The card can stay minimal because of it.
  onSelectCall: (itemId: string) => void;
}

/**
 * What the run drew, in emission order. Calls appear as one-line cards where the
 * story needs them — they can stay minimal because the complete record is one
 * click away in the list.
 */
export function Canvas({ group, onAnswer, onCancelAsk, onSelectCall }: CanvasProps) {
  if (group.run.payloadsExpired) {
    return <Canvas.Notice>Canvas no longer kept — run to see it live</Canvas.Notice>;
  }
  if (group.items.length === 0) {
    return <Canvas.Notice>{group.inFlight ? "Waiting for the first call…" : "This run drew nothing."}</Canvas.Notice>;
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-mono text-xs", group.run.stale && "opacity-70")}>
      {group.items.map((item) => (
        // Blocks keep their full height and the canvas scrolls. Without this a
        // long table is squeezed to a couple of rows to make the run fit — the
        // rows are still there, which is what makes it look like a rendering
        // bug rather than a layout one.
        <div key={item.id} className="shrink-0">
          <Canvas.Item item={item} onAnswer={onAnswer} onCancelAsk={onCancelAsk} onSelectCall={onSelectCall} />
        </div>
      ))}
    </div>
  );
}

Canvas.Notice = function ({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-3 text-center text-xs text-muted-foreground">{children}</div>;
};

interface ItemProps {
  item: ConsoleItem;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
  onSelectCall: (itemId: string) => void;
}

Canvas.Item = function ({ item, onAnswer, onCancelAsk, onSelectCall }: ItemProps) {
  if (item.call) return <Canvas.CallCard call={item.call} onSelect={() => onSelectCall(item.id)} />;
  if (item.logs) return <Canvas.Logs logs={item.logs} />;
  if (!item.block) return null;
  return <Canvas.Block id={item.id} block={item.block} onAnswer={onAnswer} onCancelAsk={onCancelAsk} />;
};

interface BlockProps {
  id: string;
  block: Block;
  onAnswer: (blockId: string, answer: string) => void;
  onCancelAsk: (blockId: string) => void;
}

Canvas.Block = function ({ id, block, onAnswer, onCancelAsk }: BlockProps) {
  switch (block.kind) {
    case "text":
      return <Canvas.Text block={block} />;
    case "code":
      return <Canvas.Code block={block} />;
    case "table":
      return <Canvas.Table block={block} />;
    case "ask":
      return <Canvas.Ask id={id} block={block} onAnswer={onAnswer} onCancelAsk={onCancelAsk} />;
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

// A wide table scrolls inside itself; the canvas never scrolls sideways as a
// whole, because everything above and below it would move with it.
Canvas.Table = function ({ block }: { block: TableBlock }) {
  return (
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
          {block.rows.map((row, rowIndex) => (
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
      {block.rows.length === 0 && <div className="py-1.5 text-muted-foreground">No rows yet…</div>}
    </div>
  );
};

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
 */
Canvas.Ask = function ({ id, block, onAnswer, onCancelAsk }: AskProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const waiting = block.answer === undefined && !block.cancelled;

  useEffect(() => {
    if (waiting) inputRef.current?.focus();
  }, [waiting]);

  return (
    <div className={cn("flex flex-col gap-2 rounded-r-md border-l-2 py-2.5 pl-3 pr-3", waiting ? "border-amber-500 bg-amber-500/10" : "border-border bg-card")}>
      <div className={cn("whitespace-pre-wrap break-words", waiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{block.question}</div>
      {waiting ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500 bg-background px-2.5 py-1.5">
          <input
            ref={inputRef}
            data-testid="canvas-ask-input"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Answer…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAnswer(id, value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancelAsk(id);
              }
            }}
          />
          <span className="shrink-0 text-muted-foreground">⏎</span>
        </div>
      ) : (
        <div className={cn("break-words", block.cancelled ? "italic text-muted-foreground" : "text-foreground")}>
          {block.cancelled ? "Cancelled" : block.answer}
        </div>
      )}
    </div>
  );
};

// A call on the canvas is a one-line card: enough to place it in the story, and
// a click away from the row that holds everything about it.
Canvas.CallCard = function ({ call, onSelect }: { call: MethodCall; onSelect: () => void }) {
  const status = call.error ? "error" : call.output === undefined && call.streamOutputs === undefined ? "pending" : "success";
  const code = callErrorCode(call);

  return (
    <button
      type="button"
      data-testid="canvas-call-card"
      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-left hover:bg-accent"
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
