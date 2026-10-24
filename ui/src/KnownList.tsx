import { cn } from "./cn";
import { endpointLabel } from "./knownServers";

export interface KnownEntry {
  name: string;
  address: string;
  mark: (props: { size?: number; className?: string }) => React.ReactNode;
}

interface KnownListProps {
  heading: string;
  // What every row says at its end while nothing has been typed.
  note?: string;
  entries: KnownEntry[];
  query: string;
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (index: number) => void;
  footer: React.ReactNode;
}

// What Kaja knows the address of, under the field it fills in. Rows are the height of
// that field, and the footer is the escape hatch: everything here is an offer, and
// pasting an address nobody bundled is the ordinary way to use the form.
export function KnownList({ heading, note, entries, query, highlight, onHighlight, onPick, footer }: KnownListProps) {
  const typed = query.trim().length > 0;
  return (
    // Keep focus in the input so a click on a row isn't lost to blur.
    <div
      onMouseDown={(event) => event.preventDefault()}
      className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md"
    >
      {!typed && <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">{heading}</p>}
      {entries.map((entry, index) => (
        <button
          key={entry.address}
          type="button"
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(index)}
          className={cn("flex h-8 w-full items-center gap-2 px-3 text-left", index === highlight ? "bg-accent" : "hover:bg-accent/50")}
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center text-foreground">
            <entry.mark size={16} />
          </span>
          <span className="shrink-0 text-sm text-foreground">{entry.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{endpointLabel(entry.address)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{typed && index === highlight ? "⏎" : note}</span>
        </button>
      ))}
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{footer}</p>
    </div>
  );
}

// The entry the address turned out to be, said in the field that holds it.
export function KnownChip({ entry }: { entry: Pick<KnownEntry, "name" | "mark"> }) {
  return (
    <span className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      <entry.mark size={12} />
      <span className="max-w-24 truncate">{entry.name}</span>
    </span>
  );
}
