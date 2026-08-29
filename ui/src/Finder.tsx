import { Ban, ChevronsUpDown, CircleAlert, Search, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { FileName } from "./FileName";

// The trigger caps here; over it the app label goes first, then the name truncates
// from the left so its tail — the part that identifies the call — survives.
const TRIGGER_MAX_WIDTH = 260;
// Icon, gaps, chevron and padding: what the trigger spends on everything that isn't
// the two labels.
const TRIGGER_CHROME = 66;
// With an empty query the list is where you have been, plus a glance at the rest.
const RESTING_OTHERS = 8;
const LIST_MAX_HEIGHT = 420;

export interface Destination {
  key: string;
  name: string;
  // Where it sits: "theatre / Shows", "Scripts", "Workspace".
  path: string;
  // Empty where the name is already the whole answer.
  origin: string;
  icon: LucideIcon;
  // A browsing buffer — still exactly its generated code and never run. Dimmed here and
  // in the sidebar, because the next call you pick takes it over.
  provisional?: boolean;
  // The name is a filename, so its extension is dimmed — the same two-tone name the
  // sidebar row draws, because it is the same object.
  file?: boolean;
  // A call Kaja won't make. Dimmed and marked with the glyph the tree row carries,
  // since the finder is the other list every method is in.
  uncallable?: boolean;
  // Matched but never shown. A REST method is named by its path everywhere, so the
  // generated name is nowhere on screen to be read off — and it is still what someone
  // who has been reading the declarations will type.
  search?: string;
  go: () => void;
}

interface FinderProps {
  // Most recent first; the first is where you are.
  recent: Destination[];
  elsewhere: Destination[];
  // The trigger says so, and Run beside it goes disabled on the same condition.
  errorCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // ⌘P opens on the previous place so ⌘P⏎ is "back"; a click on the trigger opens on
  // the first row, since a click carries no "back" intent.
  highlightPrevious: boolean;
}

/**
 * Where you are, and where you can go. There is no notion of open files — the pane
 * shows one thing, and this is how you reach another without walking the tree. So it
 * is a finder, not a tab list: nothing here can be closed, because nothing was opened.
 */
export function Finder({ recent, elsewhere, errorCount, open, onOpenChange, highlightPrevious }: FinderProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = recent[0];

  const { recentRows, otherRows } = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = (destination: Destination) => `${destination.name} ${destination.path} ${destination.search ?? ""}`.toLowerCase().includes(term);
    const been = recent.filter(matches);
    const rest = elsewhere.filter(matches);
    return { recentRows: been, otherRows: term ? rest : rest.slice(0, RESTING_OTHERS) };
  }, [recent, elsewhere, query]);

  const rows = useMemo(() => [...recentRows, ...otherRows], [recentRows, otherRows]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // ⌘P⏎ is how you get back to the last thing, so it starts highlighted.
    setHighlight(highlightPrevious && recent.length > 1 ? 1 : 0);
    const focus = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(focus);
  }, [open, highlightPrevious]);

  useEffect(() => {
    setHighlight((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#finder-row-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, rows.length]);

  const select = (destination: Destination | undefined) => {
    if (!destination) return;
    destination.go();
    onOpenChange(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(rows[highlight]);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          data-testid="file-switcher"
          aria-expanded={open}
          aria-controls="finder"
          aria-label={current ? `${current.name} — go to another file` : "Go to a file"}
          className={cn(
            // It gives up room before anything else in the row does — a label that truncates is
            // read; a button that shrinks is one drawn over the button next to it.
            "relative flex h-[26px] min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 hover:bg-accent",
            open && "bg-accent",
            errorCount > 0 ? "border-destructive" : "border-border",
          )}
          style={{ maxWidth: TRIGGER_MAX_WIDTH }}
        >
          <TriggerContent destination={current} errorCount={errorCount} />
          <ChevronsUpDown size={13} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id="finder"
        align="start"
        sideOffset={2}
        // Movement makes fast repeated ⌘P feel unstable, so it only fades.
        className="flex w-[380px] flex-col overflow-hidden rounded-lg p-0 shadow-lg transition-opacity duration-[120ms] data-[ending-style]:scale-100 data-[starting-style]:scale-100"
      >
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a file or call…"
            aria-label="Go to a file or call"
            aria-activedescendant={rows.length > 0 ? `finder-row-${highlight}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          {rows.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</div>}
          {recentRows.length > 0 && <GroupHeader>Recent</GroupHeader>}
          {recentRows.map((destination, index) => (
            <DestinationRow
              key={destination.key}
              destination={destination}
              index={index}
              recent
              highlighted={highlight === index}
              onHighlight={setHighlight}
              onSelect={select}
            />
          ))}
          {otherRows.length > 0 && <GroupHeader border={recentRows.length > 0}>All files</GroupHeader>}
          {otherRows.map((destination, index) => (
            <DestinationRow
              key={destination.key}
              destination={destination}
              index={recentRows.length + index}
              highlighted={highlight === recentRows.length + index}
              onHighlight={setHighlight}
              onSelect={select}
            />
          ))}
        </div>
        <div className="flex h-[32px] shrink-0 items-center border-t border-border px-3">
          <span className="text-xs text-muted-foreground">↑↓ move · ⏎ go</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupHeader({ border, children }: { border?: boolean; children: React.ReactNode }) {
  return (
    <div role="presentation" className={cn("px-3 pb-1 pt-2 text-xs text-muted-foreground", border && "mt-1 border-t border-border")}>
      {children}
    </div>
  );
}

function DestinationRow({
  destination,
  index,
  recent,
  highlighted,
  onHighlight,
  onSelect,
}: {
  destination: Destination;
  index: number;
  recent?: boolean;
  highlighted: boolean;
  onHighlight: (index: number) => void;
  onSelect: (destination: Destination) => void;
}) {
  const Icon = destination.icon;
  return (
    <div
      id={`finder-row-${index}`}
      role="option"
      aria-selected={highlighted}
      className={cn("group flex h-[30px] cursor-pointer items-center gap-2 px-3", highlighted && "bg-accent")}
      onMouseEnter={() => onHighlight(index)}
      onClick={() => onSelect(destination)}
    >
      <Icon size={13} className={cn("shrink-0 text-muted-foreground", destination.provisional && "opacity-60")} />
      <span
        className={cn("shrink-0 truncate text-sm", recent && !destination.provisional && !destination.uncallable ? "text-foreground" : "text-muted-foreground")}
      >
        {destination.file ? <FileName name={destination.name} /> : destination.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{destination.path}</span>
      {destination.uncallable && <Ban size={12} className="shrink-0 text-muted-foreground" />}
      {highlighted && <span className="shrink-0 font-mono text-xs text-muted-foreground">⏎</span>}
    </div>
  );
}

// The trigger says where you are, in 26px: icon, name, and the one qualifier that
// tells two identically named calls apart.
function TriggerContent({ destination, errorCount }: { destination?: Destination; errorCount: number }) {
  const [dropLabel, setDropLabel] = useState(false);
  const probeRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    setDropLabel(probe ? probe.offsetWidth > TRIGGER_MAX_WIDTH - TRIGGER_CHROME : false);
  }, [destination?.name, destination?.origin, errorCount]);

  if (!destination) {
    return <span className="truncate text-sm text-muted-foreground">Nothing open</span>;
  }

  const Icon = errorCount > 0 ? CircleAlert : destination.icon;
  const qualifier = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}` : destination.origin;

  return (
    <>
      {/* Measured at its natural size, clipped to nothing, so dropping the label
          can never make it fit and then unfit. */}
      <span aria-hidden className="pointer-events-none invisible absolute h-0 w-0 overflow-hidden">
        <span ref={probeRef} className="inline-block whitespace-nowrap text-sm font-medium">
          {destination.name}
          {qualifier && <span className="text-xs">{qualifier}</span>}
        </span>
      </span>
      <Icon size={13} className={cn("shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground", destination.provisional && "opacity-60")} />
      <span
        className={cn("min-w-0 truncate text-sm font-medium", destination.provisional ? "text-muted-foreground" : "text-foreground")}
        // Truncating from the left keeps the call name, which is the end of a qualified one.
        style={{ direction: "rtl", textAlign: "left" }}
      >
        {destination.file ? <FileName name={destination.name} /> : destination.name}
      </span>
      {/* The probe drops it when the name alone fills the trigger; the container
          query drops it when the row is too narrow for the trigger to be that
          wide in the first place, which the probe measures nothing about. Either
          way the qualifier goes before the name truncates — a name cut to its
          last letter says less than no qualifier does. */}
      {qualifier && !dropLabel && (
        <span className={cn("shrink-0 text-xs @max-[340px]:hidden", errorCount > 0 ? "text-destructive" : "text-muted-foreground")}>{qualifier}</span>
      )}
    </>
  );
}
