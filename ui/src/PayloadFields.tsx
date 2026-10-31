import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { timeAgo } from "./cellTime";
import { cn } from "./cn";
import { countLabel, Field, fieldCount, fields, FieldValue, MAX_FIELDS, nodeAt, Path } from "./payloadRows";

interface PayloadFieldsProps {
  value: unknown;
  // What the top level is called in the trail: "response" or "request".
  root: string;
  path: Path;
  onPathChange: (path: Path) => void;
}

// A phone's reading of a payload: one level as a list of fields, the key over its
// value at the whole width, and a nested object or list as a row that opens it.
export function PayloadFields({ value, root, path, onPathChange }: PayloadFieldsProps) {
  const node = nodeAt(value, path);
  const rows = fields(node);
  const total = fieldCount(node);
  const level = path.join("\u0000");
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Where each level was left, so going back lands on the row that was opened.
  const offsets = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = offsets.current.get(level) ?? 0;
  }, [level]);

  return (
    <div
      ref={scrollerRef}
      className="min-h-0 flex-1 overflow-auto bg-background"
      // Read as it moves rather than on the way out, by which time the next level has replaced the rows.
      onScroll={(event) => offsets.current.set(level, event.currentTarget.scrollTop)}
    >
      {path.length > 0 && <Trail root={root} path={path} onPathChange={onPathChange} />}
      {/* Keyed by the level, so its long values open folded. */}
      <div key={level}>
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-[15px] text-muted-foreground">{Array.isArray(node) ? "No items" : "No fields"}</div>
        ) : (
          rows.map((field) => <FieldRow key={field.key} field={field} onOpen={() => onPathChange([...path, field.key])} />)
        )}
        {total > rows.length && (
          <div className="px-4 py-3 text-xs text-muted-foreground">{(total - MAX_FIELDS).toLocaleString()} more not shown. Copy to get all of it.</div>
        )}
      </div>
    </div>
  );
}

function Trail({ root, path, onPathChange }: { root: string; path: Path; onPathChange: (path: Path) => void }) {
  const steps = [root, ...path.map(String)];
  return (
    <div className="sticky top-0 z-10 flex min-h-10 items-center gap-1 border-b border-border bg-background pr-4 pl-1 text-[15px]">
      <button
        type="button"
        aria-label="Back"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        onClick={() => onPathChange(path.slice(0, -1))}
      >
        <ChevronLeft size={20} />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return (
            <span key={index} className={cn("flex items-center gap-1", last ? "min-w-0" : "shrink-0")}>
              {index > 0 && <ChevronRight size={14} className="shrink-0 text-muted-foreground/60" />}
              {last ? (
                <span className="truncate font-medium text-foreground">{step}</span>
              ) : (
                <button type="button" className="text-muted-foreground active:text-foreground" onClick={() => onPathChange(path.slice(0, index))}>
                  {step}
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Past this a value is folded to its first lines, and a tap unfolds it.
const LONG_TEXT = 240;

function FieldRow({ field, onOpen }: { field: Field; onOpen: () => void }) {
  const { value } = field;
  const opens = (value.kind === "object" || value.kind === "array") && value.count > 0;
  const [unfolded, setUnfolded] = useState(false);
  const long = "text" in value && value.text.length > LONG_TEXT;

  const body = (
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs text-muted-foreground">{field.key}</div>
      <div className={cn("text-[15px] wrap-anywhere", long && !unfolded && "line-clamp-4")}>
        <Value value={value} />
      </div>
      {long && (
        <button type="button" className="mt-0.5 text-xs text-muted-foreground active:text-foreground" onClick={() => setUnfolded(!unfolded)}>
          {unfolded ? "Show less" : `Show all ${value.text.length.toLocaleString()} characters`}
        </button>
      )}
    </div>
  );

  if (!opens) return <div className="flex min-h-12 items-center border-b border-border px-4 py-2 select-text">{body}</div>;

  return (
    <button type="button" className="flex min-h-12 w-full items-center gap-2 border-b border-border px-4 py-2 text-left active:bg-accent/60" onClick={onOpen}>
      {body}
      <ChevronRight size={18} className="shrink-0 text-muted-foreground/60" />
    </button>
  );
}

function Value({ value }: { value: FieldValue }) {
  switch (value.kind) {
    case "text":
      return <span className="whitespace-pre-wrap">{value.text}</span>;
    case "url":
      return <span className="text-sky-700 dark:text-sky-400">{value.text}</span>;
    case "instant":
      // The age is the reading and the instant is what the API sent, kept beside it
      // because a phone has no hover to carry it.
      return (
        <>
          {timeAgo(value.date, Date.now())}
          <span className="ml-2 text-xs text-muted-foreground">{value.text}</span>
        </>
      );
    case "number":
      return <span className="tabular-nums">{value.text}</span>;
    case "boolean":
      return <>{value.text}</>;
    case "null":
      return <span className="text-muted-foreground">null</span>;
    case "empty":
      return <span className="text-muted-foreground italic">empty</span>;
    case "bytes":
      return <span className="text-muted-foreground">{value.length.toLocaleString()} bytes</span>;
    case "object":
    case "array":
      if (value.count === 0) return <span className="text-muted-foreground">{value.kind === "array" ? "No items" : "No fields"}</span>;
      return (
        <>
          {value.label && <span className="mr-1.5">{value.label}</span>}
          <span className="text-[13px] text-muted-foreground">
            {value.label && "· "}
            {countLabel(value)}
          </span>
        </>
      );
  }
}
