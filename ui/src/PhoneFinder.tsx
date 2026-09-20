import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { Ban, ChevronDown, ChevronRight, ChevronsUpDown, CircleAlert, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Method, Service } from "./apps";
import { appType, appTypeLabel } from "./appTypes";
import { cn } from "./cn";
import { countMethods, isCompiling } from "./compileSummary";
import { FileName } from "./FileName";
import { Destination, matchesDestination } from "./Finder";
import { matchParts, methodTag } from "./phone";
import { unsupportedReason } from "./streaming";
import { useMediaQuery } from "./useMediaQuery";

// Recent stops here so the apps start above the fold.
const RESTING_RECENT = 5;

interface PhoneFinderProps {
  // Most recent first; the first is where you are.
  recent: Destination[];
  elsewhere: Destination[];
  // Kaja's own views, each carrying the state the status bar would have shown.
  workspace: Destination[];
  apps: App[];
  onSelectMethod: (method: Method, service: Service, app: App) => void;
  // Absent where the configuration can't be written.
  onNewApp?: () => void;
  errorCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The finder as the phone's whole navigation. Its trigger is the header — the one
 * thing that says where you are — and it opens as a sheet over the window. With no
 * query it is where you have been, the app tree expanding in place, and Kaja's own
 * views; with one it is the same ranked list the desktop finder gives, with nothing
 * between the rows.
 */
export function PhoneFinder({ recent, elsewhere, workspace, apps, onSelectMethod, onNewApp, errorCount, open, onOpenChange }: PhoneFinderProps) {
  const [query, setQuery] = useState("");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // A field focused on opening brings the keyboard up over the list, and the list is
  // what the sheet opened to show.
  const touch = useMediaQuery("(hover: none)");
  const current = recent[0];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setShowAllRecent(false);
    // One app is not a choice, so it opens already unfolded.
    setExpanded(new Set(apps.length === 1 ? [apps[0].configuration.name] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const term = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (term === "") return [];
    const seen = new Set<string>();
    const rows: Destination[] = [];
    for (const destination of [...recent, ...elsewhere, ...workspace]) {
      if (seen.has(destination.key) || !matchesDestination(destination, term)) continue;
      seen.add(destination.key);
      rows.push(destination);
    }
    return rows;
  }, [recent, elsewhere, workspace, term]);

  const matchingApps = useMemo(() => (term === "" ? [] : apps.filter((app) => app.configuration.name.toLowerCase().includes(term))), [apps, term]);

  const select = (destination: Destination) => {
    destination.go();
    onOpenChange(false);
  };

  const selectMethod = (method: Method, service: Service, app: App) => {
    onSelectMethod(method, service, app);
    onOpenChange(false);
  };

  const toggleApp = (name: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const recentRows = showAllRecent ? recent : recent.slice(0, RESTING_RECENT);
  const hiddenRecent = recent.length - recentRows.length;

  const Icon = errorCount > 0 ? CircleAlert : current.icon;
  const qualifier = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}` : current.origin;

  return (
    <>
      <button
        type="button"
        role="combobox"
        data-testid="file-switcher"
        aria-expanded={open}
        aria-controls="phone-finder"
        aria-label={`${current.name}. Go to another file`}
        onClick={() => onOpenChange(true)}
        className={cn(
          "flex h-[36px] min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          errorCount > 0 ? "border-destructive" : "border-border",
        )}
      >
        <Icon size={15} className={cn("shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground", current.provisional && "opacity-60")} />
        <span className={cn("min-w-0 truncate text-sm", current.file && "font-mono", current.provisional ? "text-muted-foreground" : "text-foreground")}>
          {current.file ? <FileName name={current.name} /> : current.name}
        </span>
        {/* The place gives way before the name does. */}
        {qualifier && (
          <span className={cn("min-w-0 shrink-[3] truncate text-sm", errorCount > 0 ? "text-destructive" : "text-muted-foreground")}>{qualifier}</span>
        )}
        <ChevronsUpDown size={13} className="ml-auto shrink-0 text-muted-foreground" />
      </button>

      <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/55 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <BaseDialog.Popup
            id="phone-finder"
            aria-label="Go to a file, call or view"
            initialFocus={touch ? false : inputRef}
            className="fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col rounded-t-[14px] border-t border-border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full"
          >
            <div className="flex shrink-0 justify-center pb-1 pt-2">
              <div className="h-1 w-9 rounded-full bg-muted-foreground/40" />
            </div>
            <div className="mx-4 my-2 flex h-[44px] shrink-0 items-center gap-2 rounded-md border border-input bg-background px-3">
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              {term !== "" ? (
                <>
                  {results.length === 0 && matchingApps.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</div>
                  )}
                  {results.map((destination, index) => (
                    <ResultRow key={destination.key} destination={destination} query={query} first={index === 0} onSelect={() => select(destination)} />
                  ))}
                  {/* An app is not a place to go, so picking one opens its tree here. */}
                  {matchingApps.map((app) => (
                    <Row
                      key={`app:${app.configuration.name}`}
                      onClick={() => {
                        setQuery("");
                        setExpanded(new Set([app.configuration.name]));
                      }}
                    >
                      <span className="w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        <Matched text={app.configuration.name} query={query} />
                      </span>
                      <AppDetail app={app} />
                    </Row>
                  ))}
                </>
              ) : (
                <>
                  {recentRows.length > 0 && <SectionHeader>Recent</SectionHeader>}
                  {recentRows.map((destination, index) => (
                    <DestinationRow key={destination.key} destination={destination} current={index === 0} onSelect={() => select(destination)} />
                  ))}
                  {hiddenRecent > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRecent(true)}
                      className="flex h-10 w-full items-center pl-11 pr-4 text-left text-sm text-muted-foreground"
                    >
                      {hiddenRecent} more…
                    </button>
                  )}

                  {(apps.length > 0 || onNewApp) && (
                    <>
                      <Divider />
                      <SectionHeader>Apps</SectionHeader>
                    </>
                  )}
                  {apps.map((app) => {
                    const name = app.configuration.name;
                    const isExpanded = expanded.has(name);
                    return (
                      <div key={name}>
                        <Row onClick={() => toggleApp(name)} aria-expanded={isExpanded}>
                          {isExpanded ? (
                            <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                          <AppDetail app={app} />
                        </Row>
                        {isExpanded && !isCompiling(app) && <AppTree app={app} onSelect={selectMethod} />}
                      </div>
                    );
                  })}
                  {onNewApp && (
                    <Row
                      onClick={() => {
                        onNewApp();
                        onOpenChange(false);
                      }}
                    >
                      <Plus size={16} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">New app</span>
                    </Row>
                  )}

                  {workspace.length > 0 && (
                    <>
                      <Divider />
                      <SectionHeader>Kaja</SectionHeader>
                    </>
                  )}
                  {workspace.map((destination) => (
                    <DestinationRow key={destination.key} destination={destination} onSelect={() => select(destination)} />
                  ))}
                </>
              )}
            </div>
            {term !== "" && (
              <div className="flex h-[44px] shrink-0 items-center border-t border-border px-4 text-xs text-muted-foreground">
                {results.length + matchingApps.length} {results.length + matchingApps.length === 1 ? "match" : "matches"}
              </div>
            )}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </>
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

function Divider() {
  return <div className="mx-4 my-2 border-t border-border" />;
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

// The same sentence the sidebar's row says about an app, in the room a phone row has.
function AppDetail({ app }: { app: App }) {
  if (app.compilation.status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        failed
      </span>
    );
  }
  if (isCompiling(app)) return <span className="shrink-0 text-xs text-muted-foreground">compiling…</span>;
  const methods = countMethods(app);
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {appTypeLabel(appType(app.configuration))} · {methods} {methods === 1 ? "method" : "methods"}
    </span>
  );
}

function AppTree({ app, onSelect }: { app: App; onSelect: (method: Method, service: Service, app: App) => void }) {
  const type = appType(app.configuration);
  const grouped = app.services.length > 1;
  return (
    <>
      {app.services.map((service) => (
        <div key={`${service.packageName}.${service.name}`}>
          {grouped && <div className="flex h-8 items-center pl-11 pr-4 text-xs text-muted-foreground">{service.name}</div>}
          {service.methods.map((method) => {
            const unsupported = unsupportedReason(method, type) !== undefined;
            return (
              <Row key={method.name} onClick={() => onSelect(method, service, app)} className="pl-11">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    (unsupported || method.deprecated) && "text-muted-foreground",
                    method.deprecated && "line-through",
                  )}
                >
                  {method.name}
                </span>
                <MethodMark tag={methodTag(method)} uncallable={unsupported} />
              </Row>
            );
          })}
        </div>
      ))}
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
