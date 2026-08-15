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
  Link2,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Settings,
  Trash2,
  TriangleAlert,
  ChevronRight,
  Ellipsis,
  Plus as PlusIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { appType } from "./appTypes";
import { AppTypeIcon } from "./AppTypeIcon";
import { PreviewPill } from "./PreviewPill";
import { Method, App, Script, Service, methodId } from "./apps";
import { isUntouched, Scratch } from "./scratches";
import { titleParts } from "./scratchTitle";
import { appWarnings, firstErrorMessage } from "./compileSummary";
import { getPersistedValue, setPersistedValue } from "./storage";
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

// Width the macOS traffic lights occupy at the window's left edge. The desktop
// window hides its title bar, so whatever sits in that corner has to clear them.
export const TRAFFIC_LIGHTS_INSET = 78;

const RECENT_SCRATCHES = 6;

// A section header is a row of the same height as the rows under it — the tree
// is an index, and an index reads as a list of names.
const SECTION_ROW = "flex h-[22px] cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] font-medium text-foreground";

// Small enough to sit inside a 22px row, which is what lets the frequent verbs
// live on the row instead of behind a menu.
const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

/**
 * A script row's leading slot. It is the width of the run spinner whatever it
 * currently holds, because all four things that can appear here — a run in the
 * air, the pin, the on-disk dot, and nothing at all on the web — would otherwise
 * move the label out from under the cursor as they swap.
 *
 * The dot itself replaced the file icon: a 5px mark is quieter than a drawing in
 * a 22px row, which already spends a glyph on the app above it.
 *
 * It goes inside a `TreeView.LeadingVisual` and never wraps one — `TreeView.Item`
 * picks its slots out by child type, so a wrapper lands the glyph in the label.
 */
function ScriptGlyph({
  running,
  agent,
  waiting,
  saved,
  dim,
  dot = true,
}: {
  running?: boolean;
  agent?: boolean;
  waiting?: boolean;
  saved?: boolean;
  dim?: boolean;
  dot?: boolean;
}) {
  return (
    <span className="flex size-3 items-center justify-center">
      {/* A run parked on a question is still running, but a spinner would say it
          is working on something. The ring is the same amber the canvas and the
          run pill use for "this needs you". */}
      {waiting ? (
        <span aria-hidden title="Waiting for an answer" className="size-[5px] rounded-full bg-amber-500 ring-[3px] ring-amber-500/25" />
      ) : running ? (
        // A run you didn't start is the one you most want named, and the slot is
        // 12px — so the spinner says who by, rather than growing a second mark.
        <span className="flex" title={agent ? "An agent is running this" : "Running"}>
          <Spinner className="size-3" />
        </span>
      ) : dot ? (
        <span
          aria-hidden
          title={saved ? "On disk" : "Not on disk"}
          className={cn("size-[5px] rounded-full", saved ? "bg-muted-foreground opacity-50" : "bg-amber-500", dim && "opacity-40")}
        />
      ) : null}
    </span>
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

interface SidebarProps {
  apps: App[];
  scripts?: Script[];
  // Scratches, newest activity first. Only the most recent few are listed; the
  // rest are a ⌘P away, which is what makes an unlimited history usable.
  scratches?: Scratch[];
  currentScratchId?: string;
  currentScriptPath?: string;
  // Files with a run still in the air. A run keeps going when you navigate away
  // from it, and its console is no longer on screen to say so — the row is.
  runningFileIds?: Set<string>;
  // Of those, the ones an agent started rather than you.
  agentFileIds?: Set<string>;
  // Files whose run has stopped on a `kaja.ask*` and needs an answer.
  waitingFileIds?: Set<string>;
  // A read-only configuration doesn't disable the verbs that change apps, it
  // doesn't offer them: New and Delete both go, so there is no way to reach a
  // form whose only button can't be pressed. Settings stays — reading an app's
  // configuration is worth the trip, and its banner says why it can't be
  // edited; filling in a new app that can never be saved is not.
  canUpdateConfiguration?: boolean;
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
  // Copies the `kaja://run/<script>` link that runs this script.
  onCopyScriptLink?: (script: Script) => void;
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
  runningFileIds,
  agentFileIds,
  waitingFileIds,
  canUpdateConfiguration = true,
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
  onCopyScriptLink,
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
  // Unsaved is only a state where saving is a verb. The web has no Save, so no
  // row can leave the state it is in, and the amber count and the word "unsaved"
  // would be naming a change that can't be made; the dot goes with them, since a
  // mark that never resolves is a warning about nothing. A workspace's own
  // scripts do appear there, above the scratches, and the finder's FileCode /
  // PenLine is where that difference is drawn — a 5px dot is too quiet to carry
  // it without the colour that means "you can fix this".
  const canSave = onSaveScratch !== undefined;
  // Rename, delete and the link are all a desktop's to offer. Where none of them
  // is, the row has no menu to open — so it grows no ⋯ on hover and its
  // right-click is left to the browser, rather than opening an empty popup.
  const hasScriptMenu = onRenameScript !== undefined || onDeleteScript !== undefined || onCopyScriptLink !== undefined;
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
  // A row's verbs are revealed by the cursor, and a finger has none: on a touch
  // screen there is no hover to wait for and no right-click behind it either, so
  // the row simply carries them. Nothing moves under the pointer that way —
  // there is no pointer.
  const touch = useMediaQuery("(hover: none)");

  useEffect(() => {
    setPersistedValue("scriptsExpanded", scriptsExpanded);
  }, [scriptsExpanded]);
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
          {canUpdateConfiguration && <IconButton icon={Plus} size="sm" variant="ghost" aria-label="New app" onClick={onNewAppClick} />}
          {onVariablesClick && <IconButton icon={Braces} size="sm" variant="ghost" aria-label="Variables" onClick={onVariablesClick} />}
        </div>
        {/* Nothing on the right. Fold All and Unfold All lived here and were both
            about managing a view of the tree, which stopped being something you
            do: the tree opens on what you call, and ⌥click on a row takes its
            whole subtree. The left side makes things; that is the whole header. */}
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
                  const active = (touch || hoveredScript === script.path || scriptMenu?.script.path === script.path) && hasScriptMenu;
                  return (
                    <TreeView.Item
                      id={`script-${script.path}`}
                      key={script.path}
                      ref={(el: HTMLElement | null) => {
                        // TreeView.Item doesn't forward these handlers, so attach them to the DOM node.
                        if (el) {
                          el.oncontextmenu = (e) => {
                            if (!hasScriptMenu) return;
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
                      <TreeView.LeadingVisual>
                        <ScriptGlyph
                          running={runningFileIds?.has(script.path)}
                          agent={agentFileIds?.has(script.path)}
                          waiting={waitingFileIds?.has(script.path)}
                          saved
                          dot={canSave}
                        />
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
                  const active = touch || hoveredScratch === scratch.id || scratchMenu?.scratch.id === scratch.id;
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
                      {/* The slot stays whatever is in it. Dropping the dot to
                          seat the three buttons buys 11px the row doesn't need,
                          and costs a label that moves as you reach for it. */}
                      <TreeView.LeadingVisual>
                        <ScriptGlyph
                          running={runningFileIds?.has(scratch.id)}
                          agent={agentFileIds?.has(scratch.id)}
                          waiting={waitingFileIds?.has(scratch.id)}
                          dim={isUntouched(scratch)}
                          dot={canSave}
                        />
                      </TreeView.LeadingVisual>
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
                      className="flex h-[22px] cursor-pointer items-center pl-2 text-[13px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
                                      {/* Adding a call to the scratch you already have open is
                                          deliberate, so it gets its own target rather than
                                          happening because you clicked in the wrong mood. */}
                                      {(touch || hoveredMethod === mId) && (
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
      {/* Cursor-anchored context menu for a script. */}
      <div
        ref={scriptMenuAnchorRef}
        style={{ position: "fixed", top: scriptMenu?.top ?? 0, left: scriptMenu?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }}
      />
      <DropdownMenu open={!!scriptMenu} onOpenChange={(open) => !open && setScriptMenu(null)}>
        <DropdownMenuContent align="start" anchor={scriptMenuAnchorRef} className="w-48">
          {/* The link is the script's address outside Kaja — paste it into a
              launcher, a Shortcut, a shell. Parameters are appended to it there,
              which is where the values that fill them come from. */}
          {onCopyScriptLink && (
            <DropdownMenuItem
              onSelect={() => {
                const script = scriptMenu?.script;
                if (script) onCopyScriptLink(script);
              }}
            >
              <Link2 size={16} />
              Copy Link
            </DropdownMenuItem>
          )}
          {onRenameScript && (
            <DropdownMenuItem
              onSelect={() => {
                const script = scriptMenu?.script;
                if (script) onRenameScript(script);
              }}
            >
              <Pencil size={16} />
              Rename…
            </DropdownMenuItem>
          )}
          {/* This one takes a file off disk, which is why it is confirmed and
              why it says so. The unsaved row's menu below reads differently on
              purpose. */}
          {onDeleteScript && (
            <DropdownMenuItem
              variant="danger"
              onSelect={() => {
                const script = scriptMenu?.script;
                if (script) onDeleteScript(script);
              }}
            >
              <Trash2 size={16} />
              Delete file
            </DropdownMenuItem>
          )}
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
      {qualifier && <span className="ml-1 font-mono text-muted-foreground opacity-70">{qualifier}</span>}
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
