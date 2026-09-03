import { useState, useEffect, useRef } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { SimpleTooltip } from "./components/tooltip";
import { TreeView } from "./components/tree-view";
import {
  Ban,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleX,
  Ellipsis,
  Plug,
  Plus,
  Plus as PlusIcon,
  RotateCw,
  Settings,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { usePersistedState } from "./usePersistedState";
import { appType } from "./appTypes";
import { AppTypeIcon } from "./AppTypeIcon";
import { Method, App, Service, methodId } from "./apps";
import { appWarnings, firstErrorMessage } from "./compileSummary";
import { DEPRECATION_NOTE } from "./deprecation";
import { unsupportedReason } from "./streaming";
import { KajaTrace } from "./KajaTrace";
import { mcpDotClass, mcpPlugClass, type McpState } from "./mcpState";
import { useMediaQuery } from "./useMediaQuery";
import {
  appNodeId,
  Fold,
  FoldMap,
  groupServicesByPackage,
  hasMultiplePackages,
  isOpen,
  loadFolds,
  loadLedger,
  MethodUse,
  packageNodeId,
  pruneFolds,
  saveFolds,
  seedFolds,
  serviceNodeId,
  subtreeNodes,
  TreeApp,
} from "./treeExpansion";

/**
 * The panel is one band and two labelled sections under it.
 *
 * A control's scope decides where it lives: **+** is local, so Scripts and Apps each
 * have one, and `{ }` is about the window, so it lives in the band above both. There
 * is no search here — `⌘P` and the command row's trigger are the one search, and they
 * reach strictly more than a panel filter could.
 *
 * The left of the band belongs to the platform: the traffic lights on macOS, the
 * Kaja mark everywhere else. The tools sit flush right, so desktop and browser differ
 * by exactly one element.
 */

// The desktop window hides its title bar, so whatever sits in that corner has to
// clear the traffic lights.
export const TRAFFIC_LIGHTS_INSET = 78;

// A section header is a row of the same height as the rows under it.
const SECTION_ROW = "flex h-[22px] cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] font-medium text-foreground";

// Small enough to sit inside a 22px row, which is what lets the frequent verbs live
// on the row instead of behind a menu. Every one of them sits in an 18px box 8px in
// from the panel's right edge — one column, from the band's tools down to the last
// method in the tree.
const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

function RowAction({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: (event: React.MouseEvent) => void }) {
  return (
    <IconButton
      size="xs"
      variant="ghost"
      tooltip="native"
      aria-label={label}
      icon={icon}
      className={ROW_ACTION}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onClick(event);
      }}
    />
  );
}

interface SidebarProps {
  apps: App[];
  // Built by App and handed in whole: the sidebar's own subject is the API's catalog
  // under the Apps header, and the two lists share nothing but the panel.
  scriptsRegion?: React.ReactNode;
  // A read-only configuration doesn't disable the verbs that change apps, it doesn't
  // offer them. Settings stays — reading an app's configuration is worth the trip.
  canUpdateConfiguration?: boolean;
  // Clicking goes to the call; ⌥click (or the + on the row) adds it to the script
  // already on screen.
  onSelect: (method: Method, service: Service, app: App, mode?: "go" | "append") => void;
  onShowCompileLog: (appName: string) => void;
  onRecompileApp: (appName: string) => void;
  onNewAppClick: () => void;
  onNewScript?: () => void;
  onVariablesClick?: () => void;
  // Absent where this build offers no MCP server at all, which is what leaves the band
  // with the one tool it always had.
  onMcpClick?: () => void;
  mcpState?: McpState;
  // One-shot signal to auto-expand a just-added app (and its first service).
  autoExpandApp?: { name: string };
  // macOS desktop: inset the band to clear the traffic lights and make its empty parts
  // draggable. Also decides whether the band's left corner is the platform's or ours.
  reserveTrafficLights?: boolean;
  onEditApp: (appName: string) => void;
  onDeleteApp: (appName: string) => void;
}

export function Sidebar({
  apps,
  scriptsRegion,
  canUpdateConfiguration = true,
  onSelect,
  onShowCompileLog,
  onRecompileApp,
  onNewAppClick,
  onNewScript,
  onVariablesClick,
  onMcpClick,
  mcpState,
  autoExpandApp,
  reserveTrafficLights = false,
  onEditApp,
  onDeleteApp,
}: SidebarProps) {
  // Remembered like every other fold in the panel.
  const [scriptsOpen, setScriptsOpen] = usePersistedState("scriptsSectionExpanded", true);
  const [appsOpen, setAppsOpen] = usePersistedState("appsSectionExpanded", true);
  // Anchored at the cursor.
  const [appMenu, setAppMenu] = useState<{ appName: string; top: number; left: number } | null>(null);
  const appMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  const [hoveredMethod, setHoveredMethod] = useState<string | null>(null);
  // A row's verbs are revealed by the cursor, and a finger has none: on a touch screen
  // the row simply carries them. Nothing moves under the pointer — there is no pointer.
  const touch = useMediaQuery("(hover: none)");

  const [folds, setFolds] = useState<FoldMap>(loadFolds);

  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollRef = useRef<string | null>(null);

  const treeApps: TreeApp[] = apps.map((app) => ({ name: app.configuration.name, services: app.services }));

  useEffect(() => {
    saveFolds(folds);
  }, [folds]);

  // An app is seeded once, when it first has something to seed from; after that the
  // folds are the truth, so the tree can't rearrange itself under the cursor.
  const seededApps = useRef<Set<string>>(new Set());
  const newApps = useRef<Set<string>>(new Set());
  // The ledger as it stood when the window opened. A seed reasons about what you had
  // called before this session, never about what has happened since: a call made while
  // a slow app was still compiling would otherwise cancel that app's cold start.
  const ledgerAtLoad = useRef<MethodUse[]>(undefined);
  if (ledgerAtLoad.current === undefined) ledgerAtLoad.current = loadLedger();

  useEffect(() => {
    if (treeApps.length === 0) return;

    const targets = new Set(treeApps.filter((app) => app.services.length > 0 && !seededApps.current.has(app.name)).map((app) => app.name));
    if (targets.size > 0) {
      setFolds((prev) => seedFolds(treeApps, targets, prev, ledgerAtLoad.current!, newApps.current));
      for (const name of targets) {
        seededApps.current.add(name);
        newApps.current.delete(name);
      }
    }

    const compiling = new Set(
      apps.filter((app) => app.compilation.status === "running" || app.compilation.status === "pending").map((app) => app.configuration.name),
    );
    setFolds((prev) => pruneFolds(prev, treeApps, compiling));
  }, [apps]);

  // A just-added app takes its depth from its size once compiled: it is new, so there
  // is no history that could speak for it.
  useEffect(() => {
    if (!autoExpandApp) return;
    const { name } = autoExpandApp;
    newApps.current.add(name);
    seededApps.current.delete(name);
    setFolds((prev) => ({ ...prev, [appNodeId(name)]: "open" }));
    pendingScrollRef.current = appNodeId(name);
  }, [autoExpandApp]);

  const scrollIntoView = (elementId: string) => {
    requestAnimationFrame(() => {
      const element = elementRefs.current.get(elementId);
      if (element) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  useEffect(() => {
    if (pendingScrollRef.current) {
      const elementId = pendingScrollRef.current;
      pendingScrollRef.current = null;
      scrollIntoView(elementId);
    }
  }, [folds]);

  /**
   * Fold a node, and — on ⌥click — everything under it. That gesture is why there are
   * no fold-all and unfold-all buttons: the same verb, scoped to the row the cursor is
   * already on, at no cost in chrome.
   */
  const setFold = (app: TreeApp, nodeId: string, fold: Fold, wholeSubtree: boolean) => {
    setFolds((prev) => {
      const next = { ...prev, [nodeId]: fold };
      if (wholeSubtree) {
        for (const child of subtreeNodes(app, nodeId)) next[child] = fold;
      }
      return next;
    });
    if (fold === "open") pendingScrollRef.current = nodeId;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-chrome">
      {/* 40px, the same as the command row next to it, so the two line up across
          the seam, and on macOS the band the traffic lights sit in. What it
          holds is what belongs to the window rather than to either list below:
          the variables both lists read, and the server an agent reaches them
          through. */}
      <GlobalBand reserveTrafficLights={reserveTrafficLights} onVariablesClick={onVariablesClick} onMcpClick={onMcpClick} mcpState={mcpState} />

      {/* Both sections are the same 22px row now, which is what makes them read
          as peers: a name, the verb that belongs to that list and no other, and
          nothing that governs the panel. */}
      <SectionHeader
        id="scripts-section"
        title="Scripts"
        open={scriptsOpen}
        onToggle={() => setScriptsOpen((open) => !open)}
        actions={onNewScript && <RowAction icon={Plus} label="New script" onClick={onNewScript} />}
      />
      {scriptsOpen && (
        // Content-sized, so a short list of scripts leaves the room to the apps below. It
        // never grows: the Apps header belongs directly under the last file, not pinned to
        // the bottom where it would read as a footer.
        <div className="min-h-0 flex-[0_1_auto] overflow-y-auto pb-1">{scriptsRegion}</div>
      )}

      {/* A hairline is enough to say a new thing starts here, now that the two
          headers are the same row and the band above says nothing about either.
          Its + is the one that makes an app. */}
      <SectionHeader
        id="apps-section"
        title="Apps"
        open={appsOpen}
        onToggle={() => setAppsOpen((open) => !open)}
        seam
        actions={canUpdateConfiguration && <RowAction icon={Plus} label="New app" onClick={onNewAppClick} />}
      />
      {appsOpen && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-1">
          {apps.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {canUpdateConfiguration ? "Add an app to explore its API." : "Apps named in kaja.json appear here."}
            </div>
          )}
          {apps.map((app, appIndex) => {
            const appName = app.configuration.name;
            const treeApp = treeApps[appIndex];
            const appId = appNodeId(appName);
            const isExpanded = isOpen(folds, appId);
            // The row's own highlight stays the cursor's; only the verb on it is unconditional
            // where there is no cursor to reveal it with.
            const active = hoveredApp === appName || appMenu?.appName === appName;

            return (
              <nav
                key={appName}
                ref={(el) => {
                  if (el) elementRefs.current.set(appId, el);
                  else elementRefs.current.delete(appId);
                }}
                aria-label="Services and methods"
              >
                {/* The app keeps its icon: it is the one place in the tree where
                  the glyph says something the indent can't — gRPC or OpenAPI or
                  Folder. Everything below repeats itself, so it goes. */}
                <div
                  className={cn(SECTION_ROW, active ? "bg-accent" : "hover:bg-accent/50")}
                  onMouseEnter={() => setHoveredApp(appName)}
                  onMouseLeave={() => setHoveredApp((prev) => (prev === appName ? null : prev))}
                  onClick={(e: React.MouseEvent) => setFold(treeApp, appId, isExpanded ? "shut" : "open", e.altKey)}
                  onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setAppMenu({ appName, top: e.clientY, left: e.clientX });
                  }}
                >
                  <ChevronRight size={12} className={cn("shrink-0 text-muted-foreground transition-transform duration-[120ms]", isExpanded && "rotate-90")} />
                  <AppTypeIcon type={appType(app.configuration)} size={13} />
                  <span className="truncate">{appName}</span>
                  <AppCompileMarker app={app} onShowCompileLog={onShowCompileLog} />
                  <span className="ml-auto flex w-[18px] shrink-0 items-center justify-center">
                    {(touch || active) && (
                      <RowAction icon={Ellipsis} label={`Actions for ${appName}`} onClick={(e) => setAppMenu({ appName, top: e.clientY, left: e.clientX })} />
                    )}
                  </span>
                </div>
                {isExpanded && (
                  <TreeView guide aria-label="Services and methods">
                    {app.compilation.status === "running" || app.compilation.status === "pending" ? (
                      <LoadingTreeViewItem />
                    ) : (
                      (() => {
                        const multiplePackages = hasMultiplePackages(app.services);

                        const renderServiceItem = (service: Service) => {
                          const svcId = serviceNodeId(appName, service);
                          return (
                            <TreeView.Item
                              id={svcId}
                              key={svcId}
                              ref={(el: HTMLElement | null) => {
                                if (el) elementRefs.current.set(svcId, el);
                                else elementRefs.current.delete(svcId);
                              }}
                              expanded={isOpen(folds, svcId)}
                              onExpandedChange={(expanded, event) => setFold(treeApp, svcId, expanded ? "open" : "shut", event.altKey)}
                            >
                              {service.name}
                              <TreeView.SubTree leaf>
                                {service.methods.map((method) => {
                                  const mId = methodId(service, method);
                                  // Listed, because the tree is what the app has. Dimmed and marked,
                                  // because clicking it writes a script Kaja won't run.
                                  const unsupported = unsupportedReason(method, appType(app.configuration));
                                  return (
                                    <TreeView.Item
                                      id={mId}
                                      key={mId}
                                      ref={(el: HTMLElement | null) => {
                                        if (el) {
                                          elementRefs.current.set(mId, el);
                                          // TreeView.Item doesn't forward these, so attach them to the node.
                                          el.onmouseenter = () => setHoveredMethod(mId);
                                          el.onmouseleave = () => setHoveredMethod((previous) => (previous === mId ? null : previous));
                                        } else elementRefs.current.delete(mId);
                                      }}
                                      onSelect={(event) => onSelect(method, service, app, !unsupported && event?.altKey ? "append" : "go")}
                                    >
                                      <MethodName name={method.name} unsupported={!!unsupported} deprecated={!!method.deprecated} />
                                      <TreeView.TrailingVisual>
                                        {/* Adding a call to the draft you already have open is
                                          deliberate, so it gets its own target rather than
                                          happening because you clicked in the wrong mood. A call
                                          that can't be made is offered no way into a draft you
                                          are working in. */}
                                        {unsupported ? (
                                          <UnsupportedMarker reason={unsupported} />
                                        ) : (
                                          (touch || hoveredMethod === mId) && (
                                            <RowAction
                                              icon={PlusIcon}
                                              label={`Add ${method.name} to the open draft`}
                                              onClick={() => onSelect(method, service, app, "append")}
                                            />
                                          )
                                        )}
                                      </TreeView.TrailingVisual>
                                    </TreeView.Item>
                                  );
                                })}
                              </TreeView.SubTree>
                            </TreeView.Item>
                          );
                        };

                        if (!multiplePackages) {
                          return <>{app.services.map(renderServiceItem)}</>;
                        }

                        const packageNodes = groupServicesByPackage(app.services).map(([packageName, services]) => {
                          const packageId = packageNodeId(appName, packageName);
                          return (
                            <TreeView.Item
                              id={packageId}
                              key={packageId}
                              ref={(el: HTMLElement | null) => {
                                if (el) elementRefs.current.set(packageId, el);
                                else elementRefs.current.delete(packageId);
                              }}
                              expanded={isOpen(folds, packageId)}
                              onExpandedChange={(expanded, event) => setFold(treeApp, packageId, expanded ? "open" : "shut", event.altKey)}
                            >
                              {/* No icon: every package row carried the same one,
                                which is 20px per row spent saying what the guide
                                already says. */}
                              <span className="text-muted-foreground">{packageName}</span>
                              <TreeView.SubTree>{services.map(renderServiceItem)}</TreeView.SubTree>
                            </TreeView.Item>
                          );
                        });
                        return <>{packageNodes}</>;
                      })()
                    )}
                  </TreeView>
                )}
              </nav>
            );
          })}
        </div>
      )}
      <div ref={appMenuAnchorRef} style={{ position: "fixed", top: appMenu?.top ?? 0, left: appMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      <DropdownMenu open={!!appMenu} onOpenChange={(open) => !open && setAppMenu(null)}>
        <DropdownMenuContent align="start" anchor={appMenuAnchorRef} className="w-48">
          <DropdownMenuItem
            onSelect={() => {
              const appName = appMenu?.appName;
              if (appName) onEditApp(appName);
            }}
          >
            <Settings size={16} />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              const appName = appMenu?.appName;
              if (appName) onRecompileApp(appName);
            }}
          >
            <RotateCw size={16} />
            Recompile
          </DropdownMenuItem>
          {canUpdateConfiguration && (
            <DropdownMenuItem
              variant="danger"
              onSelect={() => {
                const appName = appMenu?.appName;
                if (appName) onDeleteApp(appName);
              }}
            >
              <Trash2 size={16} />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The panel's band: 40px, the global tools, and whatever the platform puts in the
 * window's left corner. It says nothing about the lists below it, which is what lets
 * the two sections be peers.
 */
function GlobalBand({
  reserveTrafficLights,
  onVariablesClick,
  onMcpClick,
  mcpState,
}: {
  reserveTrafficLights?: boolean;
  onVariablesClick?: () => void;
  onMcpClick?: () => void;
  mcpState?: McpState;
}) {
  const noDrag = reserveTrafficLights ? ({ "--wails-draggable": "no-drag" } as React.CSSProperties) : undefined;

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-[3px]"
      style={reserveTrafficLights ? ({ paddingLeft: TRAFFIC_LIGHTS_INSET, "--wails-draggable": "drag" } as React.CSSProperties) : undefined}
    >
      {!reserveTrafficLights && (
        <div className="flex shrink-0 select-none items-center gap-1.5 pl-2.5">
          <KajaTrace width={18} height={11} />
          <span className="text-[13px] font-semibold text-foreground">Kaja</span>
        </div>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-1" style={noDrag}>
        {onVariablesClick && (
          <SimpleTooltip text="Variables" side="bottom">
            <IconButton icon={Braces} size="sm" variant="ghost" tooltip="none" aria-label="Variables" onClick={onVariablesClick} />
          </SimpleTooltip>
        )}
        {onMcpClick && mcpState && <McpTool state={mcpState} onClick={onMcpClick} />}
      </div>
    </div>
  );
}

/**
 * The plug, and the two marks it carries. The dot answers "is it on"; the ring answers
 * "is anyone on it" — so when a client is calling the ring is up and the dot goes away
 * rather than saying the same thing twice.
 */
function McpTool({ state, onClick }: { state: McpState; onClick: () => void }) {
  const dot = mcpDotClass(state);
  return (
    <SimpleTooltip text="MCP server" side="bottom">
      <span className="relative inline-flex">
        {state === "active" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border border-emerald-500/70 animate-signal motion-reduce:animate-none motion-reduce:opacity-60"
          />
        )}
        <IconButton icon={Plug} size="sm" variant="ghost" tooltip="none" aria-label="MCP server" onClick={onClick} className={mcpPlugClass(state)} />
        {dot && <span aria-hidden className={cn("pointer-events-none absolute top-1 right-1 size-[5px] rounded-full", dot)} />}
      </span>
    </SimpleTooltip>
  );
}

/**
 * A section's header: the same 22px row as everything under it, its name, and the one
 * verb that belongs to that section. The name is the fold, not the whole row, so a
 * header can carry a button without the two competing; the chevron holds its space
 * whether revealed or not, so the name never moves.
 */
function SectionHeader({
  id,
  title,
  open,
  onToggle,
  actions,
  seam,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  // The top section has nothing above it and takes none.
  seam?: boolean;
}) {
  return (
    <div className={cn("flex h-[22px] shrink-0 items-center gap-1 pr-2", seam && "mt-1 h-[27px] border-t border-border pt-1")}>
      <h2 id={id} className="flex min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group/band flex h-[22px] min-w-0 cursor-pointer select-none items-center gap-1 rounded px-2 text-[13px] font-medium text-foreground outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
        >
          <span className="truncate">{title}</span>
          <ChevronDown
            size={12}
            className={cn(
              "shrink-0 text-muted-foreground transition-[transform,opacity] duration-[120ms]",
              open ? "opacity-0 group-hover/band:opacity-100 group-focus-visible/band:opacity-100" : "-rotate-90",
            )}
          />
        </button>
      </h2>
      {/* Not revealed by the cursor, unlike the group actions below it: making a
          draft and adding an app are the two verbs somebody comes to this panel
          for, and they were permanent while the band was theirs. */}
      <div className="ml-auto flex shrink-0 items-center">{actions}</div>
    </div>
  );
}

// A failed app otherwise looks like an app with no services. The marker says which
// app is broken and opens its log.
// A method Kaja won't call still has a row — hiding it would make the tree say the
// app has less than it does — so the row says why instead.
function UnsupportedMarker({ reason }: { reason: string }) {
  return (
    <SimpleTooltip text={reason}>
      <span role="img" aria-label={reason} className="inline-flex shrink-0 items-center text-muted-foreground">
        <Ban size={12} />
      </span>
    </SimpleTooltip>
  );
}

// A method Kaja won't call is dimmed; one the API deprecated is struck through, the
// mark the editor already puts on the call it writes. A strikethrough says nothing
// about who decided it or whether the call still goes out, so the name carries the
// sentence that does.
function MethodName({ name, unsupported, deprecated }: { name: string; unsupported: boolean; deprecated: boolean }) {
  const label = <span className={cn(unsupported && "text-muted-foreground", deprecated && "line-through decoration-muted-foreground")}>{name}</span>;
  return deprecated ? <SimpleTooltip text={DEPRECATION_NOTE}>{label}</SimpleTooltip> : label;
}

function AppCompileMarker({ app, onShowCompileLog }: { app: App; onShowCompileLog: (appName: string) => void }) {
  const failed = app.compilation.status === "error";
  const warned = appWarnings(app).length;
  if (!failed && warned === 0) return null;

  const label = failed ? (firstErrorMessage(app) ?? "Compilation failed") : `${warned} warning${warned === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      title={label}
      aria-label={`${app.configuration.name}: ${label}. Show compile log`}
      className={cn("ml-1 inline-flex shrink-0 items-center", failed ? "text-destructive" : "text-amber-600 dark:text-amber-400")}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onShowCompileLog(app.configuration.name);
      }}
    >
      {failed ? <CircleX size={12} /> : <TriangleAlert size={12} />}
    </button>
  );
}

function LoadingTreeViewItem() {
  return (
    <TreeView.Item id="loading-tree-view-item" expanded={true}>
      Loading...
      <TreeView.SubTree state="loading" count={3} leaf />
    </TreeView.Item>
  );
}
