import { useState, useEffect, useRef } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { TreeView } from "./components/tree-view";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  CircleX,
  Ellipsis,
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
 * The panel is two labelled sections, Scripts and Apps, and the label is the
 * whole of what makes them two.
 *
 * Scripts used to be the only heading in the panel, so everything below it —
 * the apps and their services — read as being inside it, and the 40px band at
 * the top read as governing the whole panel because it held the actions of both
 * halves: **+** made an app, `{ }` opened the workspace's variables, and neither
 * said which list it was about. The asymmetry was the problem, not the amount of
 * content.
 *
 * So Apps gets the same band Scripts has. A 40px bar with a name says "a new
 * thing starts here" in a way a hairline never will, and it gives each section
 * somewhere to put the verbs that belong to it and to nothing else: **+** on
 * Apps makes an app, **+** on Scripts makes a draft. Nothing else moves — the
 * groups, the rows and their indents are exactly where they were.
 *
 * Both bands fold, which is the escape valve when one section gets long, and
 * each section scrolls inside itself, so a hundred methods can't push the
 * Scripts band off the top of the panel.
 *
 * Tabs were the other candidate and were cut: the core loop is clicking a method
 * in Apps and landing in a draft under Scripts, and tabs hide one half of that
 * loop at the moment it matters. They are worth it if a third section ever
 * appears, not before.
 */

// Width the macOS traffic lights occupy at the window's left edge. The desktop
// window hides its title bar, so whatever sits in that corner has to clear them.
export const TRAFFIC_LIGHTS_INSET = 78;

// A section header is a row of the same height as the rows under it — the tree
// is an index, and an index reads as a list of names.
const SECTION_ROW = "flex h-[22px] cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] font-medium text-foreground";

// Small enough to sit inside a 22px row, which is what lets the frequent verbs
// live on the row instead of behind a menu.
const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

function RowAction({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: (event: React.MouseEvent) => void }) {
  return (
    <IconButton
      size="xs"
      variant="ghost"
      tooltip={false}
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
  // The Scripts region — Drafts and Files — built by App and handed in whole.
  // The sidebar's own subject is the API's catalog under the Apps band; the two
  // are different lists and share nothing but the panel. The band above each is
  // the sidebar's, because a section's name and a section's verbs belong
  // together and only the panel knows where the traffic lights are.
  scriptsRegion?: React.ReactNode;
  // A read-only configuration doesn't disable the verbs that change apps, it
  // doesn't offer them: New and Delete both go, so there is no way to reach a
  // form whose only button can't be pressed. Settings stays — reading an app's
  // configuration is worth the trip, and its banner says why it can't be
  // edited; filling in a new app that can never be saved is not.
  canUpdateConfiguration?: boolean;
  // Clicking goes to the call; ⌥click (or the + on the row) adds it to the
  // script already on screen.
  onSelect: (method: Method, service: Service, app: App, mode?: "go" | "append") => void;
  // Opens the compile log for an app, from the marker on a failed or warned app.
  onShowCompileLog: (appName: string) => void;
  onRecompileApp: (appName: string) => void;
  // Opens the create form to add an app (gRPC, Twirp, or a built-in integration).
  onNewAppClick: () => void;
  // Starts a blank draft — the same thing ⌘N does, on the band of the section
  // the new row lands in.
  onNewScript?: () => void;
  // Opens the variables manager tab.
  onVariablesClick?: () => void;
  // One-shot signal to auto-expand a just-added app (and its first service).
  autoExpandApp?: { name: string };
  // macOS desktop: inset the header row to clear the window traffic lights and make
  // the empty parts draggable, so the controls share the title bar band (saves a row).
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
  autoExpandApp,
  reserveTrafficLights = false,
  onEditApp,
  onDeleteApp,
}: SidebarProps) {
  // Folding a whole section is the escape valve when the other one gets long,
  // so it is remembered like every other fold in the panel.
  const [scriptsOpen, setScriptsOpen] = usePersistedState("scriptsSectionExpanded", true);
  const [appsOpen, setAppsOpen] = usePersistedState("appsSectionExpanded", true);
  // Right-click context menu for an app, anchored at the cursor.
  const [appMenu, setAppMenu] = useState<{ appName: string; top: number; left: number } | null>(null);
  const appMenuAnchorRef = useRef<HTMLDivElement>(null);
  // App row hovered, used to reveal the kebab actions button.
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  // Method row hovered, used to reveal the "add to the open draft" button.
  const [hoveredMethod, setHoveredMethod] = useState<string | null>(null);
  // A row's verbs are revealed by the cursor, and a finger has none: on a touch
  // screen there is no hover to wait for and no right-click behind it either, so
  // the row simply carries them. Nothing moves under the pointer that way —
  // there is no pointer.
  const touch = useMediaQuery("(hover: none)");

  const [folds, setFolds] = useState<FoldMap>(loadFolds);

  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollRef = useRef<string | null>(null);

  const treeApps: TreeApp[] = apps.map((app) => ({ name: app.configuration.name, services: app.services }));

  useEffect(() => {
    saveFolds(folds);
  }, [folds]);

  // Apps already seeded, and apps added since the ledger was written. An app is
  // seeded once, when it first has something to seed from; after that the folds
  // are the truth and only a click changes them, so the tree can't rearrange
  // itself under the cursor.
  const seededApps = useRef<Set<string>>(new Set());
  const newApps = useRef<Set<string>>(new Set());
  // The ledger as it stood when the window opened. A seed reasons about what you
  // had called before this session, never about what has happened since: apps
  // compile at their own pace, so a call made — or auto-opened by Kaja itself —
  // while a slow app was still compiling would otherwise cancel that app's cold
  // start and leave it shut for having been late.
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

  // A just-added app opens at once, and takes its depth from its size once it has
  // compiled: it is new, so there is no history that could speak for it.
  useEffect(() => {
    if (!autoExpandApp) return;
    const { name } = autoExpandApp;
    newApps.current.add(name);
    seededApps.current.delete(name);
    setFolds((prev) => ({ ...prev, [appNodeId(name)]: "open" }));
    pendingScrollRef.current = appNodeId(name);
  }, [autoExpandApp]);

  // Scroll expanded element into view after DOM updates
  const scrollIntoView = (elementId: string) => {
    requestAnimationFrame(() => {
      const element = elementRefs.current.get(elementId);
      if (element) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  // Scroll expanded element into view after state updates
  useEffect(() => {
    if (pendingScrollRef.current) {
      const elementId = pendingScrollRef.current;
      pendingScrollRef.current = null;
      scrollIntoView(elementId);
    }
  }, [folds]);

  /**
   * Fold a node, and — on ⌥click — everything under it. That gesture is why
   * there are no fold-all and unfold-all buttons in the header: it is the same
   * verb, scoped to the row the cursor is already on, and it costs no chrome.
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
      {/* The panel's top band, which is the Scripts band: 40px, the same as the
          command row next to it, so the two line up across the seam, and on
          macOS the band the traffic lights sit in. What it holds is what Scripts
          is about — a new draft, and the variables scripts read. */}
      <SectionBand
        id="scripts-section"
        title="Scripts"
        open={scriptsOpen}
        onToggle={() => setScriptsOpen((open) => !open)}
        reserveTrafficLights={reserveTrafficLights}
        actions={
          <>
            {onNewScript && <IconButton icon={Plus} size="sm" variant="ghost" aria-label="New script" onClick={onNewScript} />}
            {onVariablesClick && <IconButton icon={Braces} size="sm" variant="ghost" aria-label="Variables" onClick={onVariablesClick} />}
          </>
        }
      />
      {scriptsOpen && (
        // Content-sized, so a short list of scripts leaves the room to the apps
        // below rather than claiming half the panel; it shrinks and scrolls
        // inside itself once there is more of it than there is room. It never
        // grows: the Apps band belongs directly under the last file, not pinned
        // to the bottom of the panel where it would read as a footer.
        <div className="min-h-0 flex-[0_1_auto] overflow-y-auto py-1">{scriptsRegion}</div>
      )}

      {/* The same band, and that is the whole fix: Apps is a section rather than
          whatever is left below Scripts. Its + is the one that makes an app —
          it used to sit in the panel's header, where it read as belonging to
          everything. */}
      <SectionBand
        id="apps-section"
        title="Apps"
        open={appsOpen}
        onToggle={() => setAppsOpen((open) => !open)}
        seam
        actions={canUpdateConfiguration && <IconButton icon={Plus} size="sm" variant="ghost" aria-label="New app" onClick={onNewAppClick} />}
      />
      {appsOpen && (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
            // The row's own highlight stays the cursor's; only the verb on it is
            // unconditional where there is no cursor to reveal it with.
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
                  <span className="ml-auto flex w-6 shrink-0 items-center justify-center">
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
                                      onSelect={(event) => onSelect(method, service, app, event?.altKey ? "append" : "go")}
                                    >
                                      {method.name}
                                      <TreeView.TrailingVisual>
                                        {/* Adding a call to the draft you already have open is
                                          deliberate, so it gets its own target rather than
                                          happening because you clicked in the wrong mood. */}
                                        {(touch || hoveredMethod === mId) && (
                                          <RowAction
                                            icon={PlusIcon}
                                            label={`Add ${method.name} to the open draft`}
                                            onClick={() => onSelect(method, service, app, "append")}
                                          />
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
 * A section's band: 40px, its name, and the verbs that belong to that section
 * and to nothing else. Both sections wear the same one, which is the point —
 * two labelled regions read as peers, where one label above everything reads as
 * a title for the panel.
 *
 * The name is the fold, not the whole band: on macOS the top band is the window's
 * title bar, so the rest of it has to stay draggable, and a window dragged by
 * its sidebar must not fold a section on the way. The chevron is revealed by the
 * cursor while the section is open and stays put once it is shut, which is when
 * it is the only way back. It holds its space either way, so the name never
 * moves.
 */
function SectionBand({
  id,
  title,
  open,
  onToggle,
  actions,
  seam,
  reserveTrafficLights,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  // The rule that seats a band against the section above it. The top one has
  // nothing above it and takes none.
  seam?: boolean;
  reserveTrafficLights?: boolean;
}) {
  const noDrag = reserveTrafficLights ? ({ "--wails-draggable": "no-drag" } as React.CSSProperties) : undefined;
  return (
    <div
      className={cn("flex h-10 shrink-0 items-center gap-1 pr-1.5", seam && "border-t border-border")}
      style={reserveTrafficLights ? ({ paddingLeft: TRAFFIC_LIGHTS_INSET, "--wails-draggable": "drag" } as React.CSSProperties) : undefined}
    >
      <h2 id={id} className="flex min-w-0" style={noDrag}>
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
      <div className="ml-auto flex shrink-0 items-center" style={noDrag}>
        {actions}
      </div>
    </div>
  );
}

// A failed app otherwise looks like an app with no services. The marker says
// which app is broken and opens its log; warnings get the same treatment a shade
// quieter.
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
