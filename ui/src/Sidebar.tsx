import { memo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { SimpleTooltip } from "./components/tooltip";
import { TreeView } from "./components/tree-view";
import {
  Ban,
  Braces,
  Check,
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
import { appType } from "./appTypes";
import { AppTypeIcon } from "./AppTypeIcon";
import { Method, App, Service, methodId } from "./apps";
import { firstErrorMessage, summarizeCompilation, warningCount } from "./compileSummary";
import { DEPRECATION_NOTE } from "./deprecation";
import { pluralCount } from "./plural";
import { unsupportedReason } from "./streaming";
import { KajaTrace } from "./KajaTrace";
import { mcpDotClass, mcpPlugClass, type McpState } from "./mcpState";
import { useMediaQuery } from "./useMediaQuery";
import { MissingVariable, missingVariableSentence } from "./variableUsage";
import { WorkspaceMenu, type WorkspaceControl } from "./WorkspaceMenu";
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
 * The panel is one band, a row of two tabs, and whichever list the tab names.
 *
 * A control's scope decides where it lives: **+** is the active list's, so it sits on
 * the tab row beside the tab it adds to, and `{ }` is about the window, so it lives
 * in the band above. There is no search here — `⌘P` and the command row's trigger
 * are the one search, and they reach strictly more than a panel filter could.
 *
 * The left of the band belongs to the platform: the traffic lights on macOS, the
 * Kaja mark everywhere else. Where there is more than one workspace to be in, its name
 * follows, since everything under the band belongs to it. The tools sit flush right.
 */

export type SidebarTab = "apps" | "scripts";

// Apps first: it is the list a session starts in, and the tabs are numbered by
// position, so ⌘1 is the tree.
export const SIDEBAR_TABS: SidebarTab[] = ["apps", "scripts"];

// The desktop window hides its title bar, so whatever sits in that corner has to
// clear the traffic lights. They are the system's own and are drawn in the screen's
// pixels however the window is zoomed, so the room left for them is stated in those.
export const TRAFFIC_LIGHTS_INSET = "calc(78px / var(--zoom, 1))";

// An app's row, and the one row the empty list draws in its place.
const SECTION_ROW = "flex h-6 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground";

// Small enough to sit inside a 24px row, which is what lets the frequent verbs live
// on the row instead of behind a menu. Every one of them sits in an 18px box 16px in
// from the panel's right edge — one column, from the band's tools down to the last
// method in the tree.
export const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

export function RowAction({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: (event: React.MouseEvent) => void }) {
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

export interface SidebarProps {
  apps: App[];
  // Which list the panel shows. Held by the window rather than here, because the keys
  // that switch it also have to bring back a collapsed sidebar.
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  // Built by App and handed in whole: the sidebar's own subject is the API's catalog
  // on the Apps tab, and the two lists share nothing but the panel.
  scriptsRegion?: React.ReactNode;
  // A read-only workspace doesn't disable the verbs that change apps, it doesn't
  // offer them. Settings stays — reading an app's configuration is worth the trip.
  canUpdateWorkspace?: boolean;
  // Clicking goes to the call; ⌥click (or the + on the row) adds it to the script
  // already on screen.
  onSelect: (method: Method, service: Service, app: App, mode?: "go" | "append") => void;
  workspaceLoaded: boolean;
  onShowCompileLog: (appName?: string) => void;
  onRecompileApp: (appName: string) => void;
  onNewAppClick: () => void;
  onNewScript?: () => void;
  // A phone's only way to the finder, the command row being the desktop's.
  onFinderClick?: () => void;
  onVariablesClick?: () => void;
  variablesMissing?: boolean;
  // By app: what each one uses that has nothing behind it on this machine.
  missingVariables?: Map<string, MissingVariable[]>;
  onRevealVariable?: (name: string) => void;
  // Absent where this build offers no MCP server at all, which is what leaves the band
  // with the one tool it always had.
  onMcpClick?: () => void;
  mcpState?: McpState;
  // One-shot signal to auto-expand a just-added app (and its first service).
  autoExpandApp?: { name: string };
  // macOS desktop: inset the band to clear the traffic lights and make its empty parts
  // draggable. Also decides whether the band's left corner is the platform's or ours.
  reserveTrafficLights?: boolean;
  workspace?: WorkspaceControl;
  onEditApp: (appName: string) => void;
  onDeleteApp: (appName: string) => void;
}

export const Sidebar = memo(function Sidebar({
  apps,
  tab,
  onTabChange,
  scriptsRegion,
  canUpdateWorkspace = true,
  onSelect,
  workspaceLoaded,
  onShowCompileLog,
  onRecompileApp,
  onNewAppClick,
  onNewScript,
  onVariablesClick,
  variablesMissing = false,
  missingVariables,
  onRevealVariable,
  onMcpClick,
  mcpState,
  autoExpandApp,
  reserveTrafficLights = false,
  workspace,
  onEditApp,
  onDeleteApp,
}: SidebarProps) {
  // Each tab keeps its own scroll. The pane that is not on screen has no box, so its
  // offset is kept here and put back when the tab returns.
  const paneRefs = useRef<Record<SidebarTab, HTMLDivElement | null>>({ apps: null, scripts: null });
  const paneScroll = useRef<Record<SidebarTab, number>>({ apps: 0, scripts: 0 });
  useLayoutEffect(() => {
    const pane = paneRefs.current[tab];
    if (pane) pane.scrollTop = paneScroll.current[tab];
  }, [tab]);
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
    onTabChange("apps");
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
      <GlobalBand
        reserveTrafficLights={reserveTrafficLights}
        workspace={workspace}
        onVariablesClick={onVariablesClick}
        variablesMissing={variablesMissing}
        onMcpClick={onMcpClick}
        mcpState={mcpState}
      />

      <TabRow
        tab={tab}
        onTabChange={onTabChange}
        marker={(apps.length > 0 || !workspaceLoaded) && <CompileMarker apps={apps} workspaceLoaded={workspaceLoaded} onShowCompileLog={onShowCompileLog} />}
        action={
          tab === "apps"
            ? canUpdateWorkspace && <RowAction icon={Plus} label="New app" onClick={onNewAppClick} />
            : onNewScript && <RowAction icon={Plus} label="New script" onClick={onNewScript} />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Both panes stay mounted and the one not on screen is hidden, so a fold, a
          hover, or a name being typed survives a switch. */}
        <TabPane tab="apps" active={tab} paneRefs={paneRefs} paneScroll={paneScroll}>
          {/* Where there is an action, the empty list shows the action rather than
              a sentence about it: this list can be filled from here, so its one row
              is the verb, at the same 24px as the app rows it will be replaced by. */}
          {apps.length === 0 &&
            (canUpdateWorkspace ? (
              <button
                type="button"
                onClick={onNewAppClick}
                className={cn(
                  SECTION_ROW,
                  "w-full border-0 bg-transparent text-left font-normal text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                <Plus size={12} className="shrink-0" />
                <span>New app</span>
              </button>
            ) : (
              <div className="px-2 py-1 text-xs text-muted-foreground">Apps named in kaja.json appear here.</div>
            ))}
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
                  className={cn(SECTION_ROW, active ? "bg-accent/60" : "hover:bg-accent/40")}
                  onMouseEnter={() => setHoveredApp(appName)}
                  onMouseLeave={() => setHoveredApp((prev) => (prev === appName ? null : prev))}
                  onClick={(e: React.MouseEvent) => setFold(treeApp, appId, isExpanded ? "shut" : "open", e.altKey)}
                  onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setAppMenu({ appName, top: e.clientY, left: e.clientX });
                  }}
                >
                  <ChevronRight
                    size={12}
                    className={cn("shrink-0 text-muted-foreground/70 transition-transform duration-[120ms]", isExpanded && "rotate-90")}
                  />
                  <AppTypeIcon type={appType(app.configuration)} size={13} />
                  <span className="truncate">{appName}</span>
                  <AppCompileMarker app={app} onShowCompileLog={onShowCompileLog} />
                  {onRevealVariable && <AppVariableMarker appName={appName} missing={missingVariables?.get(appName)} onReveal={onRevealVariable} />}
                  <span className="ml-auto flex w-[18px] shrink-0 items-center justify-center">
                    {(touch || active) && (
                      <RowAction icon={Ellipsis} label={`Actions for ${appName}`} onClick={(e) => setAppMenu({ appName, top: e.clientY, left: e.clientX })} />
                    )}
                  </span>
                </div>
                {isExpanded && (
                  <TreeView nested aria-label="Services and methods">
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
                                which is 20px per row spent saying what the indent
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
        </TabPane>
        <TabPane tab="scripts" active={tab} paneRefs={paneRefs} paneScroll={paneScroll}>
          {scriptsRegion}
        </TabPane>
      </div>
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
          {canUpdateWorkspace && (
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
});

/**
 * The panel's band: 40px, the global tools, and whatever the platform puts in the
 * window's left corner. It says nothing about the lists below it; the tab row does.
 */
function GlobalBand({
  reserveTrafficLights,
  workspace,
  onVariablesClick,
  variablesMissing,
  onMcpClick,
  mcpState,
}: {
  reserveTrafficLights?: boolean;
  workspace?: WorkspaceControl;
  onVariablesClick?: () => void;
  variablesMissing?: boolean;
  onMcpClick?: () => void;
  mcpState?: McpState;
}) {
  const noDrag = reserveTrafficLights ? ({ "--wails-draggable": "no-drag" } as React.CSSProperties) : undefined;

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1 pr-[15px]"
      style={reserveTrafficLights ? ({ paddingLeft: TRAFFIC_LIGHTS_INSET, "--wails-draggable": "drag" } as React.CSSProperties) : undefined}
    >
      {workspace ? (
        <div className={cn("flex min-w-0 items-center", reserveTrafficLights ? "pl-1" : "pl-1.5")} style={noDrag}>
          <WorkspaceMenu control={workspace} withMark={!reserveTrafficLights} />
        </div>
      ) : (
        !reserveTrafficLights && (
          <div className="flex shrink-0 select-none items-center gap-1.5 pl-2.5">
            <KajaTrace width={18} height={11} />
            <span className="text-[13px] font-semibold text-foreground">Kaja</span>
          </div>
        )
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1" style={noDrag}>
        {onVariablesClick && (
          <SimpleTooltip text={variablesMissing ? "Variables: a value is missing on this machine" : "Variables"} side="bottom">
            <span className="relative inline-flex">
              <IconButton icon={Braces} size="sm" variant="ghost" tooltip="none" aria-label="Variables" onClick={onVariablesClick} />
              {variablesMissing && <span aria-hidden className="pointer-events-none absolute top-1 right-1 size-[5px] rounded-full bg-amber-500" />}
            </span>
          </SimpleTooltip>
        )}
        {onMcpClick && mcpState && <McpTool state={mcpState} onClick={onMcpClick} />}
      </div>
    </div>
  );
}

/**
 * The plug, and the two marks it carries. The dot answers "is it on"; the ring answers
 * "is anyone on it" — so when an agent is calling the ring is up and the dot goes away
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

export const TAB_LABEL: Record<SidebarTab, string> = { apps: "Apps", scripts: "Scripts" };

export function sidebarTabId(tab: SidebarTab): string {
  return `${tab}-tab`;
}

/**
 * The row under the band: the two tabs, and the verb that belongs to the one that is
 * on. The active tab is a filled pill and nothing divides the row from the list, so
 * the panel is one plane that the tone step alone sets apart from the work area.
 *
 * The compile marker rides inside the Apps tab whichever tab is on, because it reports
 * on the apps rather than on the list in front of you. It is a sibling of the tab
 * button rather than a child, since a button can't hold another one.
 */
function TabRow({
  tab,
  onTabChange,
  marker,
  action,
}: {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  marker?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center pr-5 pl-2.5">
      <div
        role="tablist"
        aria-label="Sidebar"
        className="flex items-center gap-1"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const index = SIDEBAR_TABS.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1);
          const next = SIDEBAR_TABS[(index + SIDEBAR_TABS.length) % SIDEBAR_TABS.length];
          onTabChange(next);
          document.getElementById(sidebarTabId(next))?.focus();
        }}
      >
        {SIDEBAR_TABS.map((candidate) => {
          const selected = candidate === tab;
          const tabMarker = candidate === "apps" && marker ? marker : undefined;
          return (
            <span key={candidate} className={cn("flex h-6 items-center rounded-md", selected && "bg-muted", tabMarker !== undefined && "pr-1")}>
              <button
                type="button"
                role="tab"
                id={sidebarTabId(candidate)}
                aria-selected={selected}
                aria-controls={`${candidate}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(candidate)}
                className={cn(
                  "flex h-full cursor-pointer select-none items-center rounded-md px-2 text-[13px] outline-none focus-visible:bg-accent/50",
                  selected ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  tabMarker !== undefined && "pr-1.5",
                )}
              >
                {TAB_LABEL[candidate]}
              </button>
              {tabMarker}
            </span>
          );
        })}
      </div>
      {/* Not revealed by the cursor, unlike the row actions below it: making a draft
          and adding an app are the two verbs somebody comes to this panel for. */}
      <div className="ml-auto flex shrink-0 items-center">{action}</div>
    </div>
  );
}

/**
 * What compiling the apps came to, as one 18px glyph on the Apps tab: a check when
 * every app is ready, a spinner while any is compiling, a dot when one failed or
 * warned. Clicking opens the compile log, on the first failure if there is one.
 */
export function CompileMarker({
  apps,
  workspaceLoaded,
  onShowCompileLog,
  large = false,
}: {
  apps: App[];
  workspaceLoaded: boolean;
  onShowCompileLog: (appName?: string) => void;
  large?: boolean;
}) {
  const summary = summarizeCompilation(apps, workspaceLoaded);
  const label = summary.state === "ready" ? `${pluralCount(summary.total, "app")} compiled` : summary.label;
  const firstFailure = apps.find((app) => app.compilation.status === "error") ?? apps.find((app) => warningCount(app) > 0);

  return (
    <SimpleTooltip text={`${label} · Show compile log`} side="bottom">
      <button
        type="button"
        aria-label={`${label}. Show compile log`}
        onClick={() => onShowCompileLog(firstFailure?.configuration.name)}
        className={cn("flex shrink-0 items-center justify-center rounded-sm hover:bg-accent", large ? "size-7 rounded-full" : "size-[18px]")}
      >
        {summary.state === "loading" || summary.state === "compiling" ? (
          <Spinner size="sm" className={cn("text-muted-foreground", large ? "size-4" : "size-3")} />
        ) : summary.state === "failed" ? (
          <span className={cn("rounded-full bg-destructive", large ? "size-2" : "size-[7px]")} />
        ) : summary.state === "warning" ? (
          <span className={cn("rounded-full bg-amber-500", large ? "size-2" : "size-[7px]")} />
        ) : (
          <Check size={large ? 16 : 12} className="text-emerald-600 dark:text-emerald-400" />
        )}
      </button>
    </SimpleTooltip>
  );
}

function TabPane({
  tab,
  active,
  paneRefs,
  paneScroll,
  children,
}: {
  tab: SidebarTab;
  active: SidebarTab;
  paneRefs: React.RefObject<Record<SidebarTab, HTMLDivElement | null>>;
  paneScroll: React.RefObject<Record<SidebarTab, number>>;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${tab}-panel`}
      aria-labelledby={sidebarTabId(tab)}
      hidden={tab !== active}
      ref={(el) => {
        paneRefs.current[tab] = el;
      }}
      onScroll={(event) => {
        paneScroll.current[tab] = event.currentTarget.scrollTop;
      }}
      className="min-h-0 flex-1 overflow-y-auto py-2 pr-3 pl-2"
    >
      {children}
    </div>
  );
}

// A failed app otherwise looks like an app with no services. The marker says which
// app is broken and opens its log.
// A method Kaja won't call still has a row — hiding it would make the tree say the
// app has less than it does — so the row says why instead.
export function UnsupportedMarker({ reason, size = 12 }: { reason: string; size?: number }) {
  return (
    <SimpleTooltip text={reason}>
      <span role="img" aria-label={reason} className="inline-flex shrink-0 items-center text-muted-foreground">
        <Ban size={size} />
      </span>
    </SimpleTooltip>
  );
}

// A method Kaja won't call is dimmed; one the API deprecated is dimmed and struck
// through, the mark the editor already puts on the call it writes. Both are dimmed
// because a line drawn across a name at full weight collides with the letterforms at
// 13px, and the dimming was never what told the two apart: the `Ban` in the trailing
// slot is, and so is the `+` a deprecated row keeps. A strikethrough says nothing
// about who decided it, so the name carries the sentence that does.
export function MethodName({ name, unsupported, deprecated }: { name: string; unsupported: boolean; deprecated: boolean }) {
  const label = <span className={cn((unsupported || deprecated) && "text-muted-foreground", deprecated && "line-through")}>{name}</span>;
  return deprecated ? <SimpleTooltip text={DEPRECATION_NOTE}>{label}</SimpleTooltip> : label;
}

export function AppCompileMarker({ app, onShowCompileLog, size = 12 }: { app: App; onShowCompileLog: (appName: string) => void; size?: number }) {
  const failed = app.compilation.status === "error";
  const warned = warningCount(app);
  if (!failed && warned === 0) return null;

  const label = failed ? (firstErrorMessage(app) ?? "Compilation failed") : pluralCount(warned, "warning");

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
      {failed ? <CircleX size={size} /> : <TriangleAlert size={size} />}
    </button>
  );
}

// Beside the compile marker rather than folded into it: the app compiled, and what it
// is missing is a value on this machine rather than anything the compile log can say.
export function AppVariableMarker({
  appName,
  missing,
  onReveal,
  size = 12,
}: {
  appName: string;
  missing?: MissingVariable[];
  onReveal: (name: string) => void;
  size?: number;
}) {
  if (!missing || missing.length === 0) return null;
  const label = missing.map(missingVariableSentence).join(". ");
  return (
    <button
      type="button"
      title={label}
      aria-label={`${appName}: ${label}. Show variables`}
      className="ml-1 inline-flex shrink-0 items-center text-amber-600 dark:text-amber-400"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onReveal(missing[0].name);
      }}
    >
      <Braces size={size} />
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
