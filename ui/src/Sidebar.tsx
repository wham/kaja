import { useState, useEffect, useRef } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { TreeView } from "./components/tree-view";
import {
  Braces,
  Check,
  CircleX,
  FileCode,
  FoldVertical,
  Pencil,
  Pin,
  Plus,
  RotateCw,
  Save,
  Settings,
  Trash2,
  TriangleAlert,
  UnfoldVertical,
  ChevronRight,
  Ellipsis,
  Plus as PlusIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { appType, getAppType } from "./appTypes";
import { SimpleTooltip } from "./components/tooltip";
import { Method, App, Script, Service, methodId } from "./apps";
import { isUntouched, Scratch } from "./scratches";
import { titleParts } from "./scratchTitle";
import { appWarnings, firstErrorMessage } from "./compileSummary";
import { getPersistedValue, setPersistedValue } from "./storage";

// Width the macOS traffic lights occupy at the window's left edge. The desktop
// window hides its title bar, so whatever sits in that corner has to clear them.
export const TRAFFIC_LIGHTS_INSET = 78;

function hasMultiplePackages(services: Service[]): boolean {
  if (services.length === 0) return false;
  const first = services[0].packageName;
  return services.some((s) => s.packageName !== first);
}

function groupServicesByPackage(services: Service[]): [string, Service[]][] {
  const groups = new Map<string, Service[]>();
  for (const service of services) {
    const pkg = service.packageName;
    if (!groups.has(pkg)) {
      groups.set(pkg, []);
    }
    groups.get(pkg)!.push(service);
  }
  return [...groups.entries()];
}

const RECENT_SCRATCHES = 6;

const pillClass = "ml-1.5 rounded bg-accent px-[5px] py-px text-[9px] font-bold text-accent-foreground";

// A section header is a row of the same height as the rows under it — the tree
// is an index, and an index reads as a list of names.
const SECTION_ROW = "flex h-[22px] cursor-pointer select-none items-center gap-1.5 px-2 text-xs font-medium text-foreground";

// Small enough to sit inside a 22px row, which is what lets the frequent verbs
// live on the row instead of behind a menu.
const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

/**
 * Whether a script is on disk, in five pixels. It replaces the file icon the row
 * used to carry: the icon spent 13px saying what a dot says, and the row needs
 * the width more than the drawing.
 */
function ScriptDot({ saved, dim }: { saved?: boolean; dim?: boolean }) {
  return (
    <span
      aria-hidden
      title={saved ? "Saved" : "Not saved"}
      className={cn("size-[5px] shrink-0 rounded-full", saved ? "bg-muted-foreground opacity-50" : "bg-amber-500", dim && "opacity-40")}
    />
  );
}

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

// An app's type is its icon, the same one its New entry and its settings tab
// carry. The word is a hover away for whoever needs it.
export function AppTypeIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  const definition = getAppType(type);
  if (!definition) return null;
  const Icon = definition.icon;
  return (
    <SimpleTooltip text={definition.label}>
      <span role="img" aria-label={definition.label} className={cn("inline-flex shrink-0 items-center text-muted-foreground", className)}>
        <Icon size={size} />
      </span>
    </SimpleTooltip>
  );
}

export function PreviewPill() {
  return <span className={pillClass}>Preview</span>;
}

interface SidebarProps {
  apps: App[];
  scripts?: Script[];
  // Scratches, newest activity first. Only the most recent few are listed; the
  // rest are a ⌘P away, which is what makes an unlimited history usable.
  scratches?: Scratch[];
  currentScratchId?: string;
  currentScriptPath?: string;
  // Path of the script pinned to the macOS "Run Kaja Script" text service.
  pinnedScriptPath?: string;
  // Files with a run still in the air. A run keeps going when you navigate away
  // from it, and its console is no longer on screen to say so — the row is.
  runningFileIds?: Set<string>;
  canDeleteApps?: boolean;
  // Clicking goes to the call; ⌥click (or the + on the row) adds it to the
  // script already on screen.
  onSelect: (method: Method, service: Service, app: App, mode?: "go" | "append") => void;
  onScratchSelect?: (scratch: Scratch) => void;
  onDeleteScratch?: (scratch: Scratch) => void;
  onSaveScratch?: (scratch: Scratch) => void;
  // The bulk verbs on the Scripts header. They only ever touch the unsaved ones,
  // so clearing the pile is safe by construction.
  onSaveAllScratches?: () => void;
  onDiscardAllScratches?: () => void;
  // Opens the finder on the full list.
  onShowAllScratches?: () => void;
  onScriptSelect?: (script: Script) => void;
  onRenameScript?: (script: Script) => void;
  onDeleteScript?: (script: Script) => void;
  onPinScript?: (script: Script) => void;
  // Opens the compile log for an app, from the marker on a failed or warned app.
  onShowCompileLog: (appName: string) => void;
  onRecompileApp: (appName: string) => void;
  // Opens the create form to add an app (gRPC, Twirp, or a built-in integration).
  onNewAppClick: () => void;
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
  scripts,
  scratches,
  currentScratchId,
  currentScriptPath,
  pinnedScriptPath,
  runningFileIds,
  canDeleteApps = true,
  onSelect,
  onScratchSelect,
  onDeleteScratch,
  onSaveScratch,
  onSaveAllScratches,
  onDiscardAllScratches,
  onShowAllScratches,
  onScriptSelect,
  onRenameScript,
  onDeleteScript,
  onPinScript,
  onShowCompileLog,
  onRecompileApp,
  onNewAppClick,
  onVariablesClick,
  autoExpandApp,
  reserveTrafficLights = false,
  onEditApp,
  onDeleteApp,
}: SidebarProps) {
  const hasScripts = (scripts?.length ?? 0) > 0;
  const hasScratches = (scratches?.length ?? 0) > 0;
  const unsavedCount = scratches?.length ?? 0;
  const scriptCount = (scripts?.length ?? 0) + unsavedCount;
  // On disk versus not is only a distinction where there is a disk. The web has
  // no Save, so every row is in the same state and the dot, the amber count and
  // the word "unsaved" would all be marking a difference that can't exist.
  const canSave = onSaveScratch !== undefined;
  const [scriptsExpanded, setScriptsExpanded] = useState<boolean>(() => getPersistedValue<boolean>("scriptsExpanded") ?? true);
  // The Scripts header trades its count for the bulk verbs while it is hovered.
  const [scriptsHeaderHovered, setScriptsHeaderHovered] = useState(false);
  // Right-click context menu for a script, anchored at the cursor.
  const [scriptMenu, setScriptMenu] = useState<{ script: Script; top: number; left: number } | null>(null);
  const scriptMenuAnchorRef = useRef<HTMLDivElement>(null);
  // Script row hovered, used to reveal the kebab actions button.
  const [hoveredScript, setHoveredScript] = useState<string | null>(null);
  // Right-click context menu for an app, anchored at the cursor.
  const [appMenu, setAppMenu] = useState<{ appName: string; top: number; left: number } | null>(null);
  const appMenuAnchorRef = useRef<HTMLDivElement>(null);
  // App row hovered, used to reveal the kebab actions button.
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);
  // Method row hovered, used to reveal the "add to scratch" button.
  const [hoveredMethod, setHoveredMethod] = useState<string | null>(null);
  // Right-click context menu for a scratch, anchored at the cursor.
  const [scratchMenu, setScratchMenu] = useState<{ scratch: Scratch; top: number; left: number } | null>(null);
  const scratchMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [hoveredScratch, setHoveredScratch] = useState<string | null>(null);

  useEffect(() => {
    setPersistedValue("scriptsExpanded", scriptsExpanded);
  }, [scriptsExpanded]);
  const hadPersistedState = useRef(getPersistedValue<string[]>("expandedApps") !== undefined);

  const [expandedApps, setExpandedApps] = useState<Set<string>>(() => {
    const stored = getPersistedValue<string[]>("expandedApps");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((v): v is string => typeof v === "string"));
    }
    return new Set<string>();
  });

  const [expandedServices, setExpandedServices] = useState<Set<string>>(() => {
    const stored = getPersistedValue<string[]>("expandedServices");
    if (Array.isArray(stored)) {
      return new Set(stored.filter((v): v is string => typeof v === "string"));
    }
    return new Set<string>();
  });

  const elementRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingScrollRef = useRef<string | null>(null);

  // Helper to get service element id
  const getServiceElementId = (appName: string, service: Service) => {
    const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
    return `${appName}-${serviceKey}`;
  };

  // Helper to get package element id (used when multiple packages are shown as subtrees)
  const getPackageElementId = (appName: string, packageName: string) => {
    return `${appName}-pkg:${packageName}`;
  };

  // Persist expanded state
  useEffect(() => {
    setPersistedValue("expandedApps", [...expandedApps]);
  }, [expandedApps]);

  useEffect(() => {
    setPersistedValue("expandedServices", [...expandedServices]);
  }, [expandedServices]);

  // On first visit, expand first two apps. On subsequent loads, prune stale keys.
  useEffect(() => {
    if (apps.length === 0) return;

    if (!hadPersistedState.current) {
      setExpandedApps((prev) => {
        if (prev.size === 0) {
          return new Set(apps.slice(0, 2).map((p) => p.configuration.name));
        }
        return prev;
      });
      setExpandedServices((prev) => {
        if (prev.size === 0) {
          const initialServices = new Set<string>();
          apps.slice(0, 2).forEach((app) => {
            if (app.services.length > 0) {
              // If multiple packages, also expand the first package
              if (hasMultiplePackages(app.services)) {
                initialServices.add(getPackageElementId(app.configuration.name, app.services[0].packageName));
              }
              initialServices.add(getServiceElementId(app.configuration.name, app.services[0]));
            }
          });
          return initialServices;
        }
        return prev;
      });
      // Only mark initialized once services exist, so defaults retry after compilation finishes
      if (apps.some((p) => p.services.length > 0)) {
        hadPersistedState.current = true;
      }
      return;
    }

    // Prune stale entries that no longer match current apps/services
    const validApps = new Set(apps.map((p) => p.configuration.name));
    const validServices = new Set<string>();
    const compilingPrefixes: string[] = [];
    for (const app of apps) {
      if (app.compilation.status === "running" || app.compilation.status === "pending") {
        compilingPrefixes.push(app.configuration.name + "-");
      }
      // Add package IDs as valid when multiple packages exist
      if (hasMultiplePackages(app.services)) {
        const seenPackages = new Set<string>();
        for (const service of app.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            validServices.add(getPackageElementId(app.configuration.name, service.packageName));
          }
        }
      }
      for (const service of app.services) {
        validServices.add(getServiceElementId(app.configuration.name, service));
      }
    }

    setExpandedApps((prev) => {
      const pruned = new Set([...prev].filter((p) => validApps.has(p)));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });

    setExpandedServices((prev) => {
      const pruned = new Set([...prev].filter((s) => validServices.has(s) || compilingPrefixes.some((prefix) => s.startsWith(prefix))));
      if (pruned.size !== prev.size) return pruned;
      return prev;
    });
  }, [apps]);

  // Auto-expand a just-added app. The app is expanded immediately;
  // its first service (and first package, when several exist) is expanded once
  // compilation finishes and services become available.
  const pendingFirstServiceExpand = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!autoExpandApp) return;
    const { name } = autoExpandApp;
    setExpandedApps((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
    pendingFirstServiceExpand.current.add(name);
    pendingScrollRef.current = name;
  }, [autoExpandApp]);

  useEffect(() => {
    if (pendingFirstServiceExpand.current.size === 0) return;
    const idsToExpand: string[] = [];
    const ready: string[] = [];
    for (const name of pendingFirstServiceExpand.current) {
      const app = apps.find((p) => p.configuration.name === name);
      if (app && app.services.length > 0) {
        if (hasMultiplePackages(app.services)) {
          idsToExpand.push(getPackageElementId(name, app.services[0].packageName));
        }
        idsToExpand.push(getServiceElementId(name, app.services[0]));
        ready.push(name);
      }
    }
    if (idsToExpand.length > 0) {
      setExpandedServices((prev) => {
        const next = new Set(prev);
        idsToExpand.forEach((id) => next.add(id));
        return next;
      });
      ready.forEach((n) => pendingFirstServiceExpand.current.delete(n));
    }
  }, [apps]);

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
  }, [expandedApps, expandedServices]);

  const toggleAppExpanded = (appName: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appName)) {
        next.delete(appName);
      } else {
        next.add(appName);
        pendingScrollRef.current = appName;
      }
      return next;
    });
  };

  const foldAll = () => {
    setExpandedApps(new Set());
    setExpandedServices(new Set());
  };

  const unfoldAll = () => {
    const allApps = new Set(apps.map((p) => p.configuration.name));
    const allServices = new Set<string>();
    for (const app of apps) {
      if (hasMultiplePackages(app.services)) {
        const seenPackages = new Set<string>();
        for (const service of app.services) {
          if (!seenPackages.has(service.packageName)) {
            seenPackages.add(service.packageName);
            allServices.add(getPackageElementId(app.configuration.name, service.packageName));
          }
        }
      }
      for (const service of app.services) {
        allServices.add(getServiceElementId(app.configuration.name, service));
      }
    }
    setExpandedApps(allApps);
    setExpandedServices(allServices);
  };

  return (
    <div className="bg-chrome" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        // 40px, the same as the command row next to it, so the two line up
        // across the seam.
        style={
          reserveTrafficLights
            ? ({
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                height: 40,
                paddingLeft: TRAFFIC_LIGHTS_INSET,
                paddingRight: 8,
                "--wails-draggable": "drag",
              } as React.CSSProperties)
            : { display: "flex", alignItems: "center", height: 40, padding: "0 12px", flexShrink: 0 }
        }
      >
        <div
          style={
            reserveTrafficLights
              ? ({ display: "flex", alignItems: "center", "--wails-draggable": "no-drag" } as React.CSSProperties)
              : { display: "flex", alignItems: "center" }
          }
        >
          <IconButton icon={Plus} size="sm" variant="ghost" aria-label="New app" onClick={onNewAppClick} />
          {onVariablesClick && <IconButton icon={Braces} size="sm" variant="ghost" aria-label="Variables" onClick={onVariablesClick} />}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={
            reserveTrafficLights
              ? ({ display: "flex", alignItems: "center", "--wails-draggable": "no-drag" } as React.CSSProperties)
              : { display: "flex", alignItems: "center" }
          }
        >
          <IconButton icon={FoldVertical} size="sm" variant="ghost" aria-label="Fold All" onClick={foldAll} />
          <IconButton icon={UnfoldVertical} size="sm" variant="ghost" aria-label="Unfold All" onClick={unfoldAll} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", minHeight: 0 }}>
        {/* One list, not two. A script that has been saved and one that hasn't
            are the same kind of thing — the only difference is whether it is on
            disk, which is what the dot says. Saved ones sit on top because they
            are a library; the rest are recent work, and the whole history is a
            ⌘P away. */}
        {(hasScripts || hasScratches) && (
          <nav aria-label="Scripts">
            <div
              className={cn(SECTION_ROW, "hover:bg-accent/50")}
              onClick={() => setScriptsExpanded((v) => !v)}
              onMouseEnter={() => setScriptsHeaderHovered(true)}
              onMouseLeave={() => setScriptsHeaderHovered(false)}
            >
              <ChevronRight size={12} className={cn("shrink-0 text-muted-foreground transition-transform duration-[120ms]", scriptsExpanded && "rotate-90")} />
              <span className="truncate">Scripts</span>
              {/* The pile of drafts is a number you can act on, so the header
                  says how big it is and, under the cursor, offers the two verbs
                  that only ever touch it. Saved scripts are never in scope. */}
              {canSave && unsavedCount > 0 && <span className="shrink-0 text-amber-600 dark:text-amber-400">{unsavedCount} unsaved</span>}
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                {scriptsHeaderHovered && unsavedCount > 0 ? (
                  <>
                    {onSaveAllScratches && (
                      <RowAction icon={Save} label={`Save ${unsavedCount} unsaved ${unsavedCount === 1 ? "script" : "scripts"}`} onClick={onSaveAllScratches} />
                    )}
                    {onDiscardAllScratches && (
                      <RowAction
                        icon={Trash2}
                        label={
                          canSave
                            ? `Discard ${unsavedCount} unsaved ${unsavedCount === 1 ? "script" : "scripts"}`
                            : `Discard all ${unsavedCount} ${unsavedCount === 1 ? "script" : "scripts"}`
                        }
                        onClick={onDiscardAllScratches}
                      />
                    )}
                  </>
                ) : (
                  scriptCount > 0 && <span className="pr-1 font-mono text-muted-foreground">{scriptCount}</span>
                )}
              </span>
            </div>
            {scriptsExpanded && (
              <TreeView leaf aria-label="Scripts">
                {(scripts ?? []).map((script) => {
                  const active = hoveredScript === script.path || scriptMenu?.script.path === script.path;
                  return (
                    <TreeView.Item
                      id={`script-${script.path}`}
                      key={script.path}
                      ref={(el: HTMLElement | null) => {
                        // TreeView.Item doesn't forward these handlers, so attach them to the DOM node.
                        if (el) {
                          el.oncontextmenu = (e) => {
                            e.preventDefault();
                            setScriptMenu({ script, top: e.clientY, left: e.clientX });
                          };
                          el.onmouseenter = () => setHoveredScript(script.path);
                          el.onmouseleave = () => setHoveredScript((prev) => (prev === script.path ? null : prev));
                        }
                      }}
                      onSelect={() => onScriptSelect?.(script)}
                      // Scripts are the one part of the tree where the keyboard
                      // may remove something: a file still asks first.
                      onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onScriptSelect?.(script);
                        } else if ((event.key === "Backspace" || event.key === "Delete") && onDeleteScript) {
                          event.preventDefault();
                          onDeleteScript(script);
                        }
                      }}
                      current={currentScriptPath === script.path}
                    >
                      {/* One button fits the reserved slot, so a saved row keeps
                          its dot under the cursor. Pin takes the same place, and
                          says the file answers the macOS service. */}
                      <TreeView.LeadingVisual>
                        {runningFileIds?.has(script.path) ? (
                          <Spinner className="size-3" />
                        ) : pinnedScriptPath === script.path ? (
                          <Pin size={12} />
                        ) : (
                          <ScriptDot saved />
                        )}
                      </TreeView.LeadingVisual>
                      {script.name}
                      <TreeView.TrailingVisual>
                        {active && (
                          <RowAction
                            icon={Ellipsis}
                            label={`Actions for ${script.name}`}
                            onClick={(e) => setScriptMenu({ script, top: e.clientY, left: e.clientX })}
                          />
                        )}
                      </TreeView.TrailingVisual>
                    </TreeView.Item>
                  );
                })}
                {(scratches ?? []).slice(0, RECENT_SCRATCHES).map((scratch) => {
                  const active = hoveredScratch === scratch.id || scratchMenu?.scratch.id === scratch.id;
                  return (
                    <TreeView.Item
                      id={`scratch-${scratch.id}`}
                      key={scratch.id}
                      ref={(el: HTMLElement | null) => {
                        if (el) {
                          el.oncontextmenu = (e) => {
                            e.preventDefault();
                            setScratchMenu({ scratch, top: e.clientY, left: e.clientX });
                          };
                          el.onmouseenter = () => setHoveredScratch(scratch.id);
                          el.onmouseleave = () => setHoveredScratch((prev) => (prev === scratch.id ? null : prev));
                        }
                      }}
                      onSelect={() => onScratchSelect?.(scratch)}
                      // Discarding one costs nothing and is taken back for eight
                      // seconds, so the key can do it without asking.
                      onKeyDown={(event: React.KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onScratchSelect?.(scratch);
                        } else if (event.key === "Backspace" || event.key === "Delete") {
                          event.preventDefault();
                          onDeleteScratch?.(scratch);
                        }
                      }}
                      current={currentScratchId === scratch.id}
                    >
                      {/* The dot stays put under the cursor. Dropping it to seat
                          the three buttons buys 11px the row doesn't need, and
                          costs a label that moves as you reach for it. */}
                      {canSave && (
                        <TreeView.LeadingVisual>
                          {runningFileIds?.has(scratch.id) ? <Spinner className="size-3" /> : <ScriptDot dim={isUntouched(scratch)} />}
                        </TreeView.LeadingVisual>
                      )}
                      <ScratchLabel scratch={scratch} />
                      <TreeView.TrailingVisual className={active ? "w-auto gap-0.5" : undefined}>
                        {active && (
                          <>
                            {onSaveScratch && <RowAction icon={Check} label={`Save ${scratch.title}`} onClick={() => onSaveScratch(scratch)} />}
                            <RowAction icon={X} label={`Discard ${scratch.title}`} onClick={() => onDeleteScratch?.(scratch)} />
                            <RowAction
                              icon={Ellipsis}
                              label={`Actions for ${scratch.title}`}
                              onClick={(e) => setScratchMenu({ scratch, top: e.clientY, left: e.clientX })}
                            />
                          </>
                        )}
                      </TreeView.TrailingVisual>
                    </TreeView.Item>
                  );
                })}
                {(scratches?.length ?? 0) > RECENT_SCRATCHES && (
                  <li role="treeitem">
                    <div
                      onClick={onShowAllScratches}
                      className="flex h-[22px] cursor-pointer items-center pl-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    >
                      Show all {scriptCount}…
                    </div>
                  </li>
                )}
              </TreeView>
            )}
          </nav>
        )}
        {/* Your scripts and the API's catalog are two different lists, and two
            rows can carry the same name across the seam. A rule keeps nobody
            reading them as one. */}
        {(hasScripts || hasScratches) && apps.length > 0 && <div className="my-1 h-px bg-border" />}
        {apps.map((app) => {
          const appName = app.configuration.name;
          const isExpanded = expandedApps.has(appName);
          const active = hoveredApp === appName || appMenu?.appName === appName;

          return (
            <nav
              key={appName}
              ref={(el) => {
                if (el) elementRefs.current.set(appName, el);
                else elementRefs.current.delete(appName);
              }}
              aria-label="Services and methods"
            >
              {/* The app keeps its icon: it is the one place in the tree where
                  the glyph says something the indent can't — gRPC or OpenAPI or
                  Markdown. Everything below repeats itself, so it goes. */}
              <div
                className={cn(SECTION_ROW, active ? "bg-accent" : "hover:bg-accent/50")}
                onMouseEnter={() => setHoveredApp(appName)}
                onMouseLeave={() => setHoveredApp((prev) => (prev === appName ? null : prev))}
                onClick={() => toggleAppExpanded(appName)}
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
                  {active && (
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
                        const serviceKey = service.packageName ? `${service.packageName}.${service.name}` : service.name;
                        const svcId = `${appName}-${serviceKey}`;
                        const isServiceExpanded = expandedServices.has(svcId);
                        return (
                          <TreeView.Item
                            id={svcId}
                            key={serviceKey}
                            ref={(el: HTMLElement | null) => {
                              if (el) elementRefs.current.set(svcId, el);
                              else elementRefs.current.delete(svcId);
                            }}
                            expanded={isServiceExpanded}
                            onExpandedChange={(expanded) => {
                              setExpandedServices((prev) => {
                                const next = new Set(prev);
                                if (expanded) {
                                  next.add(svcId);
                                } else {
                                  next.delete(svcId);
                                }
                                return next;
                              });
                              if (expanded) scrollIntoView(svcId);
                            }}
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
                                      {/* Adding a call to the scratch you already have open is
                                          deliberate, so it gets its own target rather than
                                          happening because you clicked in the wrong mood. */}
                                      {hoveredMethod === mId && (
                                        <RowAction
                                          icon={PlusIcon}
                                          label={`Add ${method.name} to the open scratch`}
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
                        const packageId = getPackageElementId(appName, packageName);
                        const isPackageExpanded = expandedServices.has(packageId);
                        return (
                          <TreeView.Item
                            id={packageId}
                            key={packageId}
                            ref={(el: HTMLElement | null) => {
                              if (el) elementRefs.current.set(packageId, el);
                              else elementRefs.current.delete(packageId);
                            }}
                            expanded={isPackageExpanded}
                            onExpandedChange={(expanded) => {
                              setExpandedServices((prev) => {
                                const next = new Set(prev);
                                if (expanded) {
                                  next.add(packageId);
                                } else {
                                  next.delete(packageId);
                                }
                                return next;
                              });
                              if (expanded) scrollIntoView(packageId);
                            }}
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
      {/* Cursor-anchored context menu for a script. */}
      <div
        ref={scriptMenuAnchorRef}
        style={{ position: "fixed", top: scriptMenu?.top ?? 0, left: scriptMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }}
      />
      <DropdownMenu open={!!scriptMenu} onOpenChange={(open) => !open && setScriptMenu(null)}>
        <DropdownMenuContent align="start" anchor={scriptMenuAnchorRef} className="w-48">
          {onPinScript && (
            <DropdownMenuItem
              onSelect={() => {
                const script = scriptMenu?.script;
                if (script) onPinScript(script);
              }}
            >
              <Pin size={16} />
              {pinnedScriptPath === scriptMenu?.script.path ? "Unpin from context menu" : "Pin to context menu"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              const script = scriptMenu?.script;
              if (script) onRenameScript?.(script);
            }}
          >
            <Pencil size={16} />
            Rename…
          </DropdownMenuItem>
          {/* This one takes a file off disk, which is why it is confirmed and
              why it says so. The unsaved row's menu below reads differently on
              purpose. */}
          <DropdownMenuItem
            variant="danger"
            onSelect={() => {
              const script = scriptMenu?.script;
              if (script) onDeleteScript?.(script);
            }}
          >
            <Trash2 size={16} />
            Delete file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Cursor-anchored context menu for an app. */}
      <div
        ref={scratchMenuAnchorRef}
        style={{ position: "fixed", top: scratchMenu?.top ?? 0, left: scratchMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }}
      />
      <DropdownMenu open={scratchMenu !== null} onOpenChange={(open: boolean) => !open && setScratchMenu(null)}>
        <DropdownMenuTrigger asChild>
          <span />
        </DropdownMenuTrigger>
        <DropdownMenuContent anchor={scratchMenuAnchorRef} align="start">
          {onSaveScratch && (
            <DropdownMenuItem
              onSelect={() => {
                if (scratchMenu) onSaveScratch(scratchMenu.scratch);
                setScratchMenu(null);
              }}
            >
              <FileCode size={16} />
              Save…
            </DropdownMenuItem>
          )}
          {/* Nothing is on disk to remove, so this is a discard rather than a
              delete: neutral, and undoable instead of confirmed. */}
          <DropdownMenuItem
            onSelect={() => {
              if (scratchMenu) onDeleteScratch?.(scratchMenu.scratch);
              setScratchMenu(null);
            }}
          >
            <X size={16} />
            Discard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
          {canDeleteApps && (
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
 * An unsaved script's row. Two things are said here that the plain title can't:
 * the qualifier the naming rule produced is dimmed, so a row never reads as the
 * bare method name a few rows below it in the tree; and a scratch nobody has
 * worked in yet is dimmed whole, because "the next call takes this one over" is
 * otherwise a rule you can only learn by being surprised by it.
 */
function ScratchLabel({ scratch }: { scratch: Scratch }) {
  const { name, qualifier } = titleParts(scratch.title);
  const browsing = isUntouched(scratch);

  return (
    <span title={browsing ? "Browsing — the next call you pick takes this over" : undefined} className={cn(browsing && "text-muted-foreground")}>
      {name}
      {qualifier && <span className="ml-1 font-mono text-xs text-muted-foreground opacity-70">{qualifier}</span>}
    </span>
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
