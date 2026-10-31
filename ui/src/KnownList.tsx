import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { endpointLabel } from "./knownServers";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";

export interface KnownEntry {
  name: string;
  address: string;
  mark: (props: { size?: number; className?: string }) => React.ReactNode;
  // What this row says at its end in place of the list's note.
  note?: string;
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
          onClick={() => {
            onPick(index);
            // A tapped row is the field filled in, so a phone's keyboard has nothing left to type.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
          className={cn("flex h-8 w-full items-center gap-2 px-3 text-left", index === highlight ? "bg-accent" : "hover:bg-accent/50")}
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center text-foreground">
            <entry.mark size={16} />
          </span>
          <span className="shrink-0 text-sm text-foreground">{entry.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{endpointLabel(entry.address)}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{typed && index === highlight ? "⏎" : (entry.note ?? note)}</span>
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

interface KnownMarksProps {
  entries: Pick<KnownEntry, "name" | "mark">[];
  // The field the list opens under.
  inputId: string;
  open: boolean;
  onOpen: () => void;
}

// What an empty field says before anyone clicks it: the first few marks and how many
// more, so the list is seen to be there before it is opened.
export function KnownMarks({ entries, inputId, open, onOpen }: KnownMarksProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const shown = entries.slice(0, marksShown(entries.length, phone));
  const more = entries.length - shown.length;
  return (
    <button
      type="button"
      aria-label={`Show ${entries.map((entry) => entry.name).join(", ")}`}
      // Keep focus in the input, so a click while it is focused reopens the list rather than closing it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        document.getElementById(inputId)?.focus();
        onOpen();
      }}
      className="flex h-7 items-center gap-2 rounded-sm px-2 text-muted-foreground hover:text-foreground"
    >
      {shown.map((entry) => (
        <entry.mark key={entry.name} size={14} />
      ))}
      {more > 0 && <span className="rounded-sm bg-muted px-1 text-[11px] leading-[18px] tabular-nums">+{more}</span>}
      <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
    </button>
  );
}

// The room the marks take at the end of the field.
export function knownMarksPadding(count: number, phone: boolean): string {
  const shown = marksShown(count, phone);
  if (count > shown) return phone ? "pr-32" : "pr-36";
  return ["pr-9", "pr-16", "pr-24", "pr-28"][shown];
}

// A count stands for at least two marks, never for the one it would sit in place of.
function marksShown(count: number, phone: boolean): number {
  return count <= 3 ? count : phone ? 2 : 3;
}
