import { Ban, Braces, Check, ChevronDown, ChevronRight, CircleAlert, FolderOpen, Plus, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { App, Method, Service } from "./apps";
import { appType, appTypeLabel } from "./appTypes";
import { cn } from "./cn";
import { countMethods, isCompiling } from "./compileSummary";
import { FileName } from "./FileName";
import { Destination, matchesDestination } from "./Finder";
import { KajaTrace } from "./KajaTrace";
import { matchParts, methodTag } from "./phone";
import { WorkspaceControl } from "./WorkspaceMenu";
import { unsupportedReason } from "./streaming";
import { MissingVariable, missingVariableSentence } from "./variableUsage";

// Recent stops here so the apps start above the fold.
const RESTING_RECENT = 5;

/** What the phone's header says about where you are. */
export function PhoneTitle({ current, errorCount }: { current: Destination; errorCount: number }) {
  const Icon = errorCount > 0 ? CircleAlert : current.icon;
  const qualifier = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}` : current.origin;
  return (
    <>
      <Icon size={15} className={cn("shrink-0", errorCount > 0 ? "text-destructive" : "text-muted-foreground", current.provisional && "opacity-60")} />
      <span
        className={cn("min-w-0 truncate text-sm font-medium", current.file && "font-mono", current.provisional ? "text-muted-foreground" : "text-foreground")}
      >
        {current.file ? <FileName name={current.name} /> : current.name}
      </span>
      {/* The place gives way before the name does. */}
      {qualifier && (
        <span className={cn("min-w-0 shrink-[3] truncate text-sm", errorCount > 0 ? "text-destructive" : "text-muted-foreground")}>{qualifier}</span>
      )}
    </>
  );
}

interface PhoneDrawerProps {
  // Most recent first; the first is where you are.
  recent: Destination[];
  elsewhere: Destination[];
  // Kaja's own views, each carrying the state the sidebar would have shown.
  workspace: Destination[];
  // The sidebar band's workspace menu, which heads the drawer as it heads the sidebar.
  workspaces?: WorkspaceControl;
  apps: App[];
  onSelectMethod: (method: Method, service: Service, app: App) => void;
  onEditApp: (appName: string) => void;
  missingVariables: Map<string, MissingVariable[]>;
  onRevealVariable: (name: string) => void;
  // Absent where the workspace can't be written.
  onNewApp?: () => void;
  open: boolean;
  // Set when the drawer was opened to search rather than to browse.
  searchOnOpen: boolean;
  onClose: () => void;
}

/**
 * The phone's sidebar, drawn as a drawer under the page. At rest it is where you
 * have been, the app tree expanding in place, and Kaja's own views, under the
 * workspace; its search is the same ranked list the desktop finder gives.
 */
export function PhoneDrawer({
  recent,
  elsewhere,
  workspace,
  workspaces,
  apps,
  onSelectMethod,
  onEditApp,
  missingVariables,
  onRevealVariable,
  onNewApp,
  open,
  searchOnOpen,
  onClose,
}: PhoneDrawerProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  // Folds are kept against the default rather than as a set of open apps, because
  // one app is not a choice and starts unfolded.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const only = apps.length === 1 ? apps[0].configuration.name : undefined;
  const isExpanded = (name: string) => (name === only) !== toggled.has(name);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSearching(searchOnOpen);
    setShowAllRecent(false);
    setShowWorkspaces(false);
  }, [open, searchOnOpen]);

  useEffect(() => {
    if (open && searching) inputRef.current?.focus({ preventScroll: true });
  }, [open, searching]);

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
    onClose();
  };

  const selectMethod = (method: Method, service: Service, app: App) => {
    onSelectMethod(method, service, app);
    onClose();
  };

  const toggleApp = (name: string) => {
    setToggled((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // The field goes with the search, so the focus goes back to what opened it, or
  // Escape has nothing left in the drawer to close it from.
  const stopSearching = () => {
    flushSync(() => {
      setQuery("");
      setSearching(false);
    });
    searchRef.current?.focus({ preventScroll: true });
  };

  const recentRows = showAllRecent ? recent : recent.slice(0, RESTING_RECENT);
  const hiddenRecent = recent.length - recentRows.length;

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
        {searching ? (
          <>
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results[0]) {
                    event.preventDefault();
                    select(results[0]);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    if (query !== "") setQuery("");
                    else stopSearching();
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
            <button type="button" onClick={stopSearching} className="h-9 shrink-0 px-1 text-sm text-muted-foreground">
              Cancel
            </button>
          </>
        ) : (
          <>
            {workspaces ? (
              <button
                type="button"
                onClick={() => setShowWorkspaces((shown) => !shown)}
                aria-expanded={showWorkspaces}
                aria-label={`Workspace: ${workspaces.current.name}`}
                className="flex h-9 min-w-0 items-center gap-2 rounded-md px-1.5 text-left active:bg-accent"
              >
                <KajaTrace width={20} height={12} className="shrink-0" />
                <span className="min-w-0 truncate text-base font-semibold">{workspaces.current.name}</span>
                <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", showWorkspaces && "rotate-180")} />
              </button>
            ) : (
              <div className="flex h-9 min-w-0 items-center gap-2 px-1.5">
                <KajaTrace width={20} height={12} className="shrink-0" />
                <span className="text-base font-semibold">Kaja</span>
              </div>
            )}
            <button
              ref={searchRef}
              type="button"
              aria-label="Search"
              onClick={() => {
                // Focused in the tap itself, or iOS opens no keyboard for it.
                flushSync(() => setSearching(true));
                inputRef.current?.focus({ preventScroll: true });
              }}
              className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground active:bg-accent"
            >
              <Search size={16} />
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {searching ? (
          term !== "" && (
            <>
              {results.length === 0 && matchingApps.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">Nothing matches “{query}”.</div>}
              {results.map((destination, index) => (
                <ResultRow key={destination.key} destination={destination} query={query} first={index === 0} onSelect={() => select(destination)} />
              ))}
              {/* An app is not a place to go, so picking one opens its tree here. */}
              {matchingApps.map((app) => (
                <Row
                  key={`app:${app.configuration.name}`}
                  onClick={() => {
                    if (!isExpanded(app.configuration.name)) toggleApp(app.configuration.name);
                    stopSearching();
                  }}
                >
                  <span className="w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    <Matched text={app.configuration.name} query={query} />
                  </span>
                  <AppDetail app={app} missing={missingVariables.get(app.configuration.name)} />
                </Row>
              ))}
            </>
          )
        ) : (
          <>
            {workspaces && showWorkspaces && (
              <>
                {workspaces.known.map((known) => {
                  const current = known.dir === workspaces.current.dir;
                  return (
                    <Row
                      key={known.dir}
                      onClick={() => {
                        setShowWorkspaces(false);
                        if (!current) {
                          workspaces.onOpen(known.dir);
                          onClose();
                        }
                      }}
                    >
                      <Check size={16} className={cn("shrink-0", !current && "invisible")} />
                      <span className="min-w-0 flex-1 truncate text-sm">{known.name}</span>
                    </Row>
                  );
                })}
                <Row
                  onClick={() => {
                    workspaces.onChoose();
                    onClose();
                  }}
                >
                  <FolderOpen size={16} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Open workspace…</span>
                </Row>
                <Divider />
              </>
            )}

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
              const expanded = isExpanded(name);
              const missing = missingVariables.get(name);
              return (
                <div key={name}>
                  <Row onClick={() => toggleApp(name)} aria-expanded={expanded}>
                    {expanded ? (
                      <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <AppDetail app={app} missing={missing} />
                  </Row>
                  {expanded &&
                    missing?.map((variable) => (
                      <Row
                        key={variable.name}
                        onClick={() => {
                          onRevealVariable(variable.name);
                          onClose();
                        }}
                        className="pl-11"
                      >
                        <Braces size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
                        <span className="min-w-0 flex-1 truncate text-sm text-amber-700 dark:text-amber-300">{missingVariableSentence(variable)}</span>
                      </Row>
                    ))}
                  {/* Above the tree: a failed app has none, and is the one that needs its settings. */}
                  {expanded && (
                    <Row
                      onClick={() => {
                        onEditApp(name);
                        onClose();
                      }}
                      className="pl-11"
                    >
                      <Settings size={16} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Settings</span>
                    </Row>
                  )}
                  {expanded && !isCompiling(app) && <AppTree app={app} onSelect={selectMethod} />}
                </div>
              );
            })}
            {onNewApp && (
              <Row
                onClick={() => {
                  onNewApp();
                  onClose();
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
      {searching && term !== "" && (
        <div className="flex h-[44px] shrink-0 items-center border-t border-border px-4 text-xs text-muted-foreground">
          {results.length + matchingApps.length} {results.length + matchingApps.length === 1 ? "match" : "matches"}
        </div>
      )}
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
function AppDetail({ app, missing }: { app: App; missing?: MissingVariable[] }) {
  if (app.compilation.status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        failed
      </span>
    );
  }
  if (isCompiling(app)) return <span className="shrink-0 text-xs text-muted-foreground">compiling…</span>;
  if (missing && missing.length > 0) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {missing.length === 1 ? `needs ${missing[0].name}` : `needs ${missing.length} variables`}
      </span>
    );
  }
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
