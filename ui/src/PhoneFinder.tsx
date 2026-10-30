import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Ban, CircleAlert, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { FileName } from "./FileName";
import { Destination, matchesDestination } from "./Finder";
import { matchParts, methodTag } from "./phone";
import { useMediaQuery } from "./useMediaQuery";

interface PhoneFinderProps {
  // Most recent first; the first is where you are.
  recent: Destination[];
  elsewhere: Destination[];
  errorCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The finder on a phone: its trigger is a magnifier floating at the page's foot, where
 * a thumb is, and it opens as a sheet over the window.
 * With no query it is where you have been; with one it is the same ranked list the
 * desktop finder gives, with nothing between the rows.
 */
export function PhoneFinder({ recent, elsewhere, errorCount, open, onOpenChange }: PhoneFinderProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // A field focused on opening brings the keyboard up over the list, and the list is
  // what the sheet opened to show.
  const touch = useMediaQuery("(hover: none)");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const term = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (term === "") return [];
    const seen = new Set<string>();
    const rows: Destination[] = [];
    for (const destination of [...recent, ...elsewhere]) {
      if (seen.has(destination.key) || !matchesDestination(destination, term)) continue;
      seen.add(destination.key);
      rows.push(destination);
    }
    return rows;
  }, [recent, elsewhere, term]);

  const select = (destination: Destination) => {
    destination.go();
    onOpenChange(false);
  };

  return (
    <>
      <button
        type="button"
        role="combobox"
        data-testid="file-switcher"
        aria-expanded={open}
        aria-controls="phone-finder"
        aria-label="Go to another file"
        onClick={() => onOpenChange(true)}
        className="flex size-12 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search size={22} />
      </button>

      <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/55 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <BaseDialog.Popup
            id="phone-finder"
            aria-label="Go to a file, call or view"
            initialFocus={touch ? false : inputRef}
            style={{ top: "calc(env(safe-area-inset-top) + 40px)" }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[14px] border-t border-border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
              <div className="flex h-[44px] min-w-0 flex-1 items-center gap-2 rounded-full border border-input bg-background px-4">
                <Search size={16} className="shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && results[0]) {
                      event.preventDefault();
                      select(results[0]);
                    }
                  }}
                  placeholder="Go to a file or call…"
                  aria-label="Go to a file or call"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {query !== "" && (
                  <button
                    type="button"
                    aria-label="Clear"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <BaseDialog.Close
                aria-label="Close"
                className="flex size-[44px] shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={20} />
              </BaseDialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              {term !== "" ? (
                <>
                  {results.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</div>}
                  {results.map((destination, index) => (
                    <ResultRow key={destination.key} destination={destination} query={query} first={index === 0} onSelect={() => select(destination)} />
                  ))}
                </>
              ) : (
                <>
                  {recent.length > 0 && <SectionHeader>Recent</SectionHeader>}
                  {recent.map((destination, index) => (
                    <DestinationRow key={destination.key} destination={destination} current={index === 0} onSelect={() => select(destination)} />
                  ))}
                </>
              )}
            </div>
            {term !== "" && (
              <div className="flex h-[44px] shrink-0 items-center border-t border-border px-4 text-xs text-muted-foreground">
                {results.length} {results.length === 1 ? "match" : "matches"}
              </div>
            )}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </>
  );
}

/** The header's label: where you are, or how many errors the file there has. */
export function PhoneLocation({ current, errorCount }: { current: Destination; errorCount: number }) {
  const Icon = errorCount > 0 ? CircleAlert : current.icon;
  const qualifier = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}` : current.origin;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
      <Icon size={15} className={cn("shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground", current.provisional && "opacity-60")} />
      <span className={cn("min-w-0 truncate text-sm font-medium", current.file && "font-mono", current.provisional ? "text-muted-foreground" : "text-foreground")}>
        {current.file ? <FileName name={current.name} /> : current.name}
      </span>
      {/* The place gives way before the name does. */}
      {qualifier && (
        <span className={cn("min-w-0 shrink-[3] truncate text-sm", errorCount > 0 ? "text-destructive" : "text-muted-foreground")}>{qualifier}</span>
      )}
    </div>
  );
}

function Row({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn("flex h-11 w-full items-center gap-3 px-4 text-left active:bg-accent", className)} {...props}>
      {children}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-1 pt-1 text-xs uppercase tracking-[0.06em] text-muted-foreground">{children}</div>;
}

function Matched({ text, query }: { text: string; query: string }) {
  return (
    <>
      {matchParts(text, query).map((part, index) =>
        part.match ? (
          <b key={index} className="font-semibold text-foreground">
            {part.text}
          </b>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function MethodMark({ tag, uncallable }: { tag?: "write" | "stream"; uncallable?: boolean }) {
  return (
    <>
      {tag === "write" && <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-400">write</span>}
      {tag === "stream" && <span className="shrink-0 font-mono text-xs text-muted-foreground">stream</span>}
      {uncallable && <Ban size={14} className="shrink-0 text-muted-foreground" />}
    </>
  );
}

function DestinationRow({ destination, current, onSelect }: { destination: Destination; current?: boolean; onSelect: () => void }) {
  const Icon = destination.icon;
  return (
    <Row onClick={onSelect} className={cn(current && "bg-accent")}>
      <Icon size={16} className={cn("shrink-0", current ? "text-foreground" : "text-muted-foreground", destination.provisional && "opacity-60")} />
      <span className={cn("min-w-0 truncate text-sm", destination.file && "font-mono", destination.provisional ? "text-muted-foreground" : "text-foreground")}>
        {destination.file ? <FileName name={destination.name} /> : destination.name}
      </span>
      {destination.path && <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{destination.path}</span>}
      {destination.status?.dot && <span className={cn("ml-auto size-1.5 shrink-0 rounded-full", destination.status.dot)} />}
      {destination.status?.note && (
        <span className={cn("shrink-0 text-xs text-muted-foreground", !destination.status.dot && "ml-auto")}>{destination.status.note}</span>
      )}
    </Row>
  );
}

// With a query the rows are one list, so a method says which service it is in where
// a file shows its icon: the place is the whole of what tells two names apart.
function ResultRow({ destination, query, first, onSelect }: { destination: Destination; query: string; first: boolean; onSelect: () => void }) {
  const Icon = destination.icon;
  const dimmed = destination.provisional || destination.uncallable || destination.deprecated;
  if (destination.call) {
    return (
      <Row onClick={onSelect} className={cn(first && "bg-accent")}>
        <span className="w-4 shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate text-sm", dimmed ? "text-muted-foreground" : "text-foreground", destination.deprecated && "line-through")}>
          <span className="text-muted-foreground">{destination.path.replaceAll(" / ", " › ")} › </span>
          <Matched text={destination.name} query={query} />
        </span>
        <MethodMark tag={destination.tag} uncallable={destination.uncallable} />
      </Row>
    );
  }
  return (
    <Row onClick={onSelect} className={cn(first && "bg-accent")}>
      <Icon size={16} className={cn("shrink-0", first ? "text-foreground" : "text-muted-foreground", destination.provisional && "opacity-60")} />
      <span className={cn("min-w-0 truncate text-sm", destination.file && "font-mono", dimmed ? "text-muted-foreground" : "text-foreground")}>
        <Matched text={destination.name} query={query} />
      </span>
      {destination.path && <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{destination.path}</span>}
    </Row>
  );
}
