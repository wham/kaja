import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  Plug,
  Save,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./components/dropdown-menu";
import { IconButton } from "./components/icon-button";
import { Spinner } from "./components/spinner";
import { Script } from "./apps";
import { isAgentDraft, isUntouched, orderDrafts, Draft, untouchedDrafts, VISIBLE_DRAFTS } from "./drafts";
import { titleParts } from "./draftTitle";
import { buildScriptTree, filterScripts, FolderNode, folderNameError, scriptNameParts, TreeNode, visibleRows } from "./scriptTree";
import { usePersistedState } from "./usePersistedState";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Scripts: one section, two labelled groups, and four rules holding them
 * together.
 *
 * 1. **A draft has no name and no place. A file has both.** That is the entire
 *    difference, and the group label states it. Drafts are as durable as files,
 *    so nothing about them is styled as a warning — the amber dot is gone.
 * 2. **Files never turn into drafts on their own.** Editing a saved file leaves
 *    it a file, in place, auto-saving as you type. There is one way into
 *    Drafts: run something that has no file yet.
 * 3. **Naming a draft moves it into Files**, which is the one moment the model
 *    is visible.
 * 4. **Discarding is safe by default**: untouched drafts are swept without
 *    asking, edited ones are never removed without a confirm that names them.
 *
 * **The section is what makes those two groups one thing.** Drafts and Files
 * are halves of a single question — what you run — and a reader who meets them
 * as two headers floating above the app tree has to work that out. So the
 * section says its own name once, in the band above these rows, which is the
 * sidebar's to draw: the band and the one over Apps are the same band, and it
 * takes the traffic lights and the section's own verbs with it. What is left
 * here is the two groups and the filter, which belongs to the section rather
 * than to either half — which is why it searches both.
 *
 * **And it is one list of names, in one font.** Mono on a file row was doing
 * double duty as the tell for "this one is on disk" — the group label carries
 * that now, and mono inside a nav list reads as code, which is the wrong
 * register. Every row here is the UI font; only the extension is dimmed, so a
 * file still looks like a file without shouting. Mono belongs to content — the
 * editor, the payload panes, the naming field — not to navigation.
 *
 * No dot survives at all: a draft has nothing at risk and a file auto-saves.
 * The run indicators have the trailing slot to themselves, and it is a fixed
 * width, so nothing under the cursor moves as a run starts.
 */

// Once the region passes this many rows it earns a filter. Below it the list is
// the answer and a search box is a control you have to go looking past.
const FILTER_THRESHOLD = 15;

// The base indent of a row inside a group, so the group's label and its rows
// share a left edge, and one level of folder depth.
const ROW_INDENT = 24;
const DEPTH_INDENT = 14;
// The chevron column a folder row spends and a file row doesn't.
const CHEVRON_SLOT = 18;

const GROUP_HEADER = "flex h-[22px] w-full cursor-pointer select-none items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:bg-accent/50";
const ROW = "group flex h-[22px] cursor-pointer select-none items-center gap-1.5 pr-1 text-[13px] outline-none focus-visible:bg-accent/50";
const ROW_ACTION = "size-[18px] min-h-0 min-w-0 [&_svg]:size-3";

export interface ScriptsRegionProps {
  scripts: Script[];
  folders: string[];
  drafts: Draft[];
  currentDraftId?: string;
  currentScriptPath?: string;
  runningFileIds?: ReadonlySet<string>;
  agentFileIds?: ReadonlySet<string>;
  waitingFileIds?: ReadonlySet<string>;
  // Whether this platform can write the workspace. The web reads the same
  // folder and runs the same files; it just has none of the verbs that change
  // one, so it grows none of the controls for them either.
  canWrite: boolean;

  onDraftSelect: (draft: Draft) => void;
  onNameDraft: (draft: Draft) => void;
  onDiscardDraft: (draft: Draft) => void;
  // The two sweeps on the Drafts header, each confirmed against the list it is
  // about to touch. Neither can reach a file.
  onClearUntouched: () => void;
  onClearAllDrafts: () => void;
  sweepDrafts: boolean;
  onToggleSweepDrafts: () => void;

  onScriptSelect: (script: Script) => void;
  onRenameScript?: (script: Script) => void;
  onMoveScript?: (script: Script) => void;
  onDeleteScript?: (script: Script) => void;
  onCopyScriptLink?: (script: Script) => void;
  // Inline, because the row is a real row from the first keystroke: you can see
  // where it lands while you type.
  onCreateFolder?: (path: string) => Promise<void>;
  onRenameFolder?: (path: string, name: string) => Promise<void>;
  onDeleteFolder?: (path: string) => void;
  onRevealScripts?: () => void;
}

export function ScriptsRegion(props: ScriptsRegionProps) {
  const { scripts, folders, drafts, canWrite } = props;
  const [draftsOpen, setDraftsOpen] = usePersistedState("draftsExpanded", true);
  const [filesOpen, setFilesOpen] = usePersistedState("filesExpanded", true);
  const [openFolders, setOpenFolders] = usePersistedState<string[]>("openScriptFolders", []);
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const touch = useMediaQuery("(hover: none)");

  const ordered = useMemo(() => orderDrafts(drafts), [drafts]);
  const agentDraft = ordered.find(isAgentDraft);
  // The agent's row is pinned above your own and outside the count: it isn't
  // yours, and it is not what the number is about.
  const ownDrafts = useMemo(() => ordered.filter((draft) => !isAgentDraft(draft)), [ordered]);

  const tree = useMemo(() => buildScriptTree(scripts, folders), [scripts, folders]);
  const rowCount = useMemo(() => scripts.length + folders.length + ownDrafts.length, [scripts, folders, ownDrafts]);
  const filtering = query.trim().length > 0;
  const matches = useMemo(() => filterAll(scripts, ownDrafts, query), [scripts, ownDrafts, query]);

  const rows = useMemo(() => visibleRows(tree, new Set(openFolders)), [tree, openFolders]);
  const draftsShown = filtering ? matches.drafts : showAllDrafts ? ownDrafts : ownDrafts.slice(0, VISIBLE_DRAFTS);
  const hiddenDrafts = filtering || showAllDrafts ? 0 : ownDrafts.length - draftsShown.length;

  // The folder being named, which is a real row from the first keystroke. A
  // rename is the same row, so the interaction is learned once.
  const [folderEdit, setFolderEdit] = useState<{ parent: string; path?: string; name: string } | null>(null);
  const [scriptMenu, setScriptMenu] = useState<{ script: Script; top: number; left: number } | null>(null);
  const [draftMenu, setDraftMenu] = useState<{ draft: Draft; top: number; left: number } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ path: string; top: number; left: number } | null>(null);
  const [filesMenu, setFilesMenu] = useState<{ top: number; left: number } | null>(null);
  const [draftsMenu, setDraftsMenu] = useState<{ top: number; left: number } | null>(null);

  const toggleFolder = (path: string) => setOpenFolders((open) => (open.includes(path) ? open.filter((candidate) => candidate !== path) : [...open, path]));

  const startFolder = (parent: string) => {
    setFilesOpen(true);
    if (parent) setOpenFolders((open) => (open.includes(parent) ? open : [...open, parent]));
    setFolderEdit({ parent, name: "" });
  };

  // ⇧⌘N makes one at the root, which is the same item the Files menu carries.
  useEffect(() => {
    if (!props.onCreateFolder) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        startFolder("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onCreateFolder]);

  const active = (key: string) => touch || hovered === key;

  return (
    // Named by the band above it, which is the sidebar's: the heading is stated
    // once rather than twice.
    <nav aria-labelledby="scripts-section">
      {/* The filter appears once the region is big enough to need one. It
          matches names and folder paths, flattens the result, and says how many
          it found — the one place a count lives outside the group headers,
          because there is no other way to see the size of a result. */}
      {rowCount > FILTER_THRESHOLD && (
        <div className="px-2 pb-1 pt-0.5">
          <div className="flex h-[26px] items-center gap-1.5 rounded-md border border-input bg-background px-2">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              placeholder="Filter scripts"
              aria-label="Filter scripts"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {filtering && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{matches.scripts.length + matches.drafts.length}</span>}
          </div>
        </div>
      )}

      {/* Zero drafts hides the group rather than showing an empty label: there
          is nothing there and nothing to say about it. */}
      {(agentDraft !== undefined || ownDrafts.length > 0) && (
        <>
          <GroupHeader
            label="Drafts"
            count={ownDrafts.length}
            // A filter opens both groups — the body below renders either way, so
            // the chevron has to agree with it rather than report the fold.
            open={draftsOpen || filtering}
            onToggle={() => setDraftsOpen((open) => !open)}
            action={
              ownDrafts.length > 0
                ? { icon: Trash2, label: "Clear drafts", onClick: (event) => setDraftsMenu({ top: event.clientY, left: event.clientX }) }
                : undefined
            }
          />
          {(draftsOpen || filtering) && (
            <ul role="tree" aria-label="Drafts" className="select-none">
              {agentDraft && !filtering && (
                <AgentRow
                  draft={agentDraft}
                  current={props.currentDraftId === agentDraft.id}
                  running={props.runningFileIds?.has(agentDraft.id)}
                  waiting={props.waitingFileIds?.has(agentDraft.id)}
                  active={active(`draft:${agentDraft.id}`)}
                  canWrite={canWrite}
                  onHover={(on) => setHovered(on ? `draft:${agentDraft.id}` : null)}
                  onSelect={() => props.onDraftSelect(agentDraft)}
                  onName={() => props.onNameDraft(agentDraft)}
                  onDiscard={() => props.onDiscardDraft(agentDraft)}
                />
              )}
              {draftsShown.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  current={props.currentDraftId === draft.id}
                  running={props.runningFileIds?.has(draft.id)}
                  agent={props.agentFileIds?.has(draft.id)}
                  waiting={props.waitingFileIds?.has(draft.id)}
                  active={active(`draft:${draft.id}`)}
                  canWrite={canWrite}
                  onHover={(on) => setHovered(on ? `draft:${draft.id}` : null)}
                  onSelect={() => props.onDraftSelect(draft)}
                  onName={() => props.onNameDraft(draft)}
                  onDiscard={() => props.onDiscardDraft(draft)}
                  onMenu={(event) => setDraftMenu({ draft, top: event.clientY, left: event.clientX })}
                />
              ))}
              {hiddenDrafts > 0 && (
                <li role="treeitem">
                  <div
                    onClick={() => setShowAllDrafts(true)}
                    style={{ paddingLeft: ROW_INDENT }}
                    className={cn(ROW, "text-muted-foreground opacity-75 hover:bg-accent/50 hover:text-foreground")}
                  >
                    {hiddenDrafts} more…
                  </div>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      <GroupHeader
        label="Files"
        count={scripts.length}
        open={filesOpen || filtering}
        onToggle={() => setFilesOpen((open) => !open)}
        action={
          canWrite && (props.onCreateFolder || props.onRevealScripts)
            ? { icon: Ellipsis, label: "Actions for Files", onClick: (event) => setFilesMenu({ top: event.clientY, left: event.clientX }) }
            : undefined
        }
      />
      {(filesOpen || filtering) && (
        <ul role="tree" aria-label="Files" className="select-none">
          {filtering
            ? matches.scripts.map((script) => (
                <FileRow
                  key={script.path}
                  script={script}
                  depth={0}
                  suffix={script.folder}
                  current={props.currentScriptPath === script.path}
                  running={props.runningFileIds?.has(script.path)}
                  agent={props.agentFileIds?.has(script.path)}
                  waiting={props.waitingFileIds?.has(script.path)}
                  active={active(`file:${script.path}`)}
                  hasMenu={canWrite}
                  onHover={(on) => setHovered(on ? `file:${script.path}` : null)}
                  onSelect={() => props.onScriptSelect(script)}
                  onMenu={(event) => setScriptMenu({ script, top: event.clientY, left: event.clientX })}
                />
              ))
            : rows.map((node) =>
                node.kind === "folder" ? (
                  <Fragment key={node.path}>
                    <FolderRow
                      node={node}
                      open={openFolders.includes(node.path)}
                      editing={folderEdit?.path === node.path}
                      active={active(`folder:${node.path}`)}
                      hasMenu={canWrite && props.onCreateFolder !== undefined}
                      siblingNames={siblingFolderNames(tree, node.path)}
                      onHover={(on) => setHovered(on ? `folder:${node.path}` : null)}
                      onToggle={() => toggleFolder(node.path)}
                      onMenu={(event) => setFolderMenu({ path: node.path, top: event.clientY, left: event.clientX })}
                      onRename={async (name) => {
                        await props.onRenameFolder?.(node.path, name);
                        setFolderEdit(null);
                      }}
                      onCancelRename={() => setFolderEdit(null)}
                    />
                    {/* The new row sits inside the folder it is being made in,
                        which is what lets you see where it lands as you type. */}
                    {folderEdit?.parent === node.path && folderEdit.path === undefined && (
                      <NewFolderRow
                        depth={node.depth + 1}
                        siblingNames={childFolderNames(tree, node.path)}
                        onCommit={async (name) => {
                          await props.onCreateFolder?.(`${node.path}/${name}`);
                          setFolderEdit(null);
                        }}
                        onCancel={() => setFolderEdit(null)}
                      />
                    )}
                  </Fragment>
                ) : (
                  <FileRow
                    key={node.script.path}
                    script={node.script}
                    depth={node.depth}
                    current={props.currentScriptPath === node.script.path}
                    running={props.runningFileIds?.has(node.script.path)}
                    agent={props.agentFileIds?.has(node.script.path)}
                    waiting={props.waitingFileIds?.has(node.script.path)}
                    active={active(`file:${node.script.path}`)}
                    hasMenu={canWrite}
                    onHover={(on) => setHovered(on ? `file:${node.script.path}` : null)}
                    onSelect={() => props.onScriptSelect(node.script)}
                    onMenu={(event) => setScriptMenu({ script: node.script, top: event.clientY, left: event.clientX })}
                  />
                ),
              )}
          {folderEdit && folderEdit.parent === "" && folderEdit.path === undefined && (
            <NewFolderRow
              depth={0}
              siblingNames={childFolderNames(tree, "")}
              onCommit={async (name) => {
                await props.onCreateFolder?.(name);
                setFolderEdit(null);
              }}
              onCancel={() => setFolderEdit(null)}
            />
          )}
          {/* Zero files wants a line of instruction rather than a blank space:
              this is the one screen that can say where files come from. */}
          {scripts.length === 0 && folders.length === 0 && !folderEdit && (
            <li role="treeitem">
              <div style={{ paddingLeft: ROW_INDENT }} className="flex min-h-[22px] items-center py-1 pr-3 text-xs text-muted-foreground">
                {canWrite ? "Name a draft to file it here." : "Scripts in the workspace's folder appear here."}
              </div>
            </li>
          )}
          {filtering && matches.scripts.length === 0 && (
            <li role="treeitem">
              <div style={{ paddingLeft: ROW_INDENT }} className="flex h-[22px] items-center text-xs text-muted-foreground">
                No files match “{query.trim()}”
              </div>
            </li>
          )}
        </ul>
      )}

      <CursorMenu at={draftsMenu} onClose={() => setDraftsMenu(null)} width="w-56">
        {/* Untouched means still byte-identical to the generated call: clearing
            them removes nothing you wrote, so it needs no confirm. */}
        <DropdownMenuItem onSelect={props.onClearUntouched}>
          Clear untouched
          <span className="ml-auto pl-4 text-xs text-muted-foreground">{untouchedDrafts(drafts).length}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onClearAllDrafts}>
          Clear all
          <span className="ml-auto pl-4 text-xs text-muted-foreground">{ownDrafts.length}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onToggleSweepDrafts}>
          Sweep untouched weekly
          <span className="ml-auto pl-4">{props.sweepDrafts && <Check size={13} className="text-muted-foreground" />}</span>
        </DropdownMenuItem>
      </CursorMenu>

      <CursorMenu at={filesMenu} onClose={() => setFilesMenu(null)}>
        {props.onCreateFolder && (
          <DropdownMenuItem onSelect={() => startFolder("")}>
            <FolderPlus size={16} />
            New folder…
            <span className="ml-auto pl-4 font-mono text-xs text-muted-foreground">⇧⌘N</span>
          </DropdownMenuItem>
        )}
        {props.onRevealScripts && (
          <DropdownMenuItem onSelect={props.onRevealScripts}>
            <ExternalLink size={16} />
            Reveal in Finder
          </DropdownMenuItem>
        )}
      </CursorMenu>

      <CursorMenu at={folderMenu} onClose={() => setFolderMenu(null)}>
        {props.onCreateFolder && (
          <DropdownMenuItem onSelect={() => folderMenu && startFolder(folderMenu.path)}>
            <FolderPlus size={16} />
            New folder…
          </DropdownMenuItem>
        )}
        {props.onRenameFolder && (
          <DropdownMenuItem
            onSelect={() => {
              if (!folderMenu) return;
              setFolderEdit({ parent: folderMenu.path, path: folderMenu.path, name: folderMenu.path.split("/").pop() ?? "" });
            }}
          >
            <Pencil size={16} />
            Rename…
          </DropdownMenuItem>
        )}
        {props.onDeleteFolder && (
          <DropdownMenuItem variant="danger" onSelect={() => folderMenu && props.onDeleteFolder?.(folderMenu.path)}>
            <Trash2 size={16} />
            Delete folder
          </DropdownMenuItem>
        )}
      </CursorMenu>

      <CursorMenu at={draftMenu} onClose={() => setDraftMenu(null)}>
        {canWrite && (
          <DropdownMenuItem onSelect={() => draftMenu && props.onNameDraft(draftMenu.draft)}>
            <Save size={16} />
            Name…
          </DropdownMenuItem>
        )}
        {/* Nothing is on disk to remove, so this is a discard rather than a
            delete: neutral, and undoable instead of confirmed. */}
        <DropdownMenuItem onSelect={() => draftMenu && props.onDiscardDraft(draftMenu.draft)}>
          <X size={16} />
          Discard
        </DropdownMenuItem>
      </CursorMenu>

      <CursorMenu at={scriptMenu} onClose={() => setScriptMenu(null)}>
        {/* No Save and no Revert: a file is already on disk and stays there as
            you type. And there is no route from here into Drafts either — that
            group is for things that have never had a name. */}
        {/* A script's address outside Kaja — paste it into a launcher, a
            Shortcut, a shell, and append the parameters where the values that
            fill them come from. */}
        {props.onCopyScriptLink && (
          <DropdownMenuItem onSelect={() => scriptMenu && props.onCopyScriptLink?.(scriptMenu.script)}>
            <Link2 size={16} />
            Copy Link
          </DropdownMenuItem>
        )}
        {props.onRenameScript && (
          <DropdownMenuItem onSelect={() => scriptMenu && props.onRenameScript?.(scriptMenu.script)}>
            <Pencil size={16} />
            Rename…
          </DropdownMenuItem>
        )}
        {props.onMoveScript && (
          <DropdownMenuItem onSelect={() => scriptMenu && props.onMoveScript?.(scriptMenu.script)}>
            <FolderOpen size={16} />
            Move to…
          </DropdownMenuItem>
        )}
        {/* The only destructive action in the sidebar that touches disk, and
            the only one in text-destructive. */}
        {props.onDeleteScript && (
          <DropdownMenuItem variant="danger" onSelect={() => scriptMenu && props.onDeleteScript?.(scriptMenu.script)}>
            <Trash2 size={16} />
            Delete file
          </DropdownMenuItem>
        )}
      </CursorMenu>
    </nav>
  );
}

/**
 * A group header is a 22px row like the ones under it, at text-xs, with its
 * chevron in the same column as the app rows' below. Its count earns its place
 * because the group collapses: `Drafts 12` is still readable when folded away.
 * The action beside it acts on that group and nothing else.
 */
function GroupHeader({
  label,
  count,
  open,
  onToggle,
  action,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: { icon: LucideIcon; label: string; onClick: (event: React.MouseEvent) => void };
}) {
  return (
    <div
      className={cn(GROUP_HEADER, "group/header mt-1")}
      onClick={onToggle}
      role="button"
      // Named explicitly, because the row holds a button of its own: without it
      // the group's name would absorb its action's, and neither could be
      // addressed on its own.
      aria-label={label}
      aria-expanded={open}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onToggle()}
    >
      <ChevronRight size={12} className={cn("shrink-0 transition-transform duration-[120ms]", open && "rotate-90")} />
      <span className="flex-1 truncate">{label}</span>
      {/* Revealed by the cursor, and always there for the keyboard: the verb
          belongs to this group, which is why it sits on it rather than on a
          region header that would have to say which group it meant. */}
      {action && (
        <IconButton
          size="xs"
          variant="ghost"
          tooltip={false}
          aria-label={action.label}
          icon={action.icon}
          className={cn(ROW_ACTION, "opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100")}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            action.onClick(event);
          }}
        />
      )}
      <span className="min-w-3 shrink-0 text-right tabular-nums">{count}</span>
    </div>
  );
}

function DraftRow({
  draft,
  current,
  running,
  agent,
  waiting,
  active,
  canWrite,
  onHover,
  onSelect,
  onName,
  onDiscard,
  onMenu,
}: {
  draft: Draft;
  current: boolean;
  running?: boolean;
  agent?: boolean;
  waiting?: boolean;
  active: boolean;
  canWrite: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onName: () => void;
  onDiscard: () => void;
  onMenu: (event: React.MouseEvent) => void;
}) {
  const { name, qualifier } = titleParts(draft.title);
  const browsing = isUntouched(draft);

  return (
    <li role="treeitem" aria-current={current || undefined}>
      <div
        tabIndex={0}
        style={{ paddingLeft: ROW_INDENT }}
        className={cn(ROW, current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50")}
        onClick={onSelect}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu(event);
        }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onDiscard();
          }
        }}
      >
        {/* A draft still exactly as it was generated is a browsing buffer, and
            the next call you pick takes it over — a rule you could otherwise
            only learn by being surprised by it, so the row is dimmed. */}
        <span
          title={browsing ? "Browsing — the next call you pick takes this over" : undefined}
          className={cn("flex-1 truncate", browsing && !current && "text-muted-foreground")}
        >
          {name}
          {qualifier && <span className="ml-1 text-muted-foreground opacity-70">{qualifier}</span>}
        </span>
        <RowTrailing running={running} agent={agent} waiting={waiting} wide={active}>
          {active && (
            <>
              {canWrite && <RowAction icon={Save} label={`Name ${draft.title}`} onClick={onName} />}
              <RowAction icon={X} label={`Discard ${draft.title}`} onClick={onDiscard} />
              <RowAction icon={Ellipsis} label={`Actions for ${draft.title}`} onClick={onMenu} />
            </>
          )}
        </RowTrailing>
      </div>
    </li>
  );
}

/**
 * The agent's draft. One row, shared by every client, wearing the name of
 * whichever one touched it last — an actor you recognise instead of a mechanism
 * you translate — with the Plug that already means MCP in the status bar. It
 * can be discarded like any other draft; the next snippet an agent runs makes
 * another one.
 */
function AgentRow({
  draft,
  current,
  running,
  waiting,
  active,
  canWrite,
  onHover,
  onSelect,
  onName,
  onDiscard,
}: {
  draft: Draft;
  current: boolean;
  running?: boolean;
  waiting?: boolean;
  active: boolean;
  canWrite: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onName: () => void;
  onDiscard: () => void;
}) {
  return (
    <li role="treeitem" aria-current={current || undefined}>
      <div
        tabIndex={0}
        style={{ paddingLeft: ROW_INDENT - 4 }}
        className={cn(ROW, current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50")}
        onClick={onSelect}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <Plug size={13} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate" title={`${draft.agentClient} is writing here · ${draft.title}`}>
          {draft.agentClient}
        </span>
        <span className="flex w-6 shrink-0 items-center justify-end gap-0.5">
          {active ? (
            <>
              {canWrite && <RowAction icon={Save} label={`Name what ${draft.agentClient} wrote`} onClick={onName} />}
              <RowAction icon={X} label={`Clear ${draft.agentClient}'s draft`} onClick={onDiscard} />
            </>
          ) : waiting ? (
            <span aria-hidden title="Waiting for an answer" className="size-[5px] rounded-full bg-amber-500 ring-[3px] ring-amber-500/25" />
          ) : running ? (
            // The only live indicator in the sidebar: it goes out the moment the
            // call finishes and the row stays, name and all.
            <span aria-hidden title={`${draft.agentClient} is running this`} className="size-[5px] rounded-full bg-emerald-500" />
          ) : null}
        </span>
      </div>
    </li>
  );
}

function FolderRow({
  node,
  open,
  editing,
  active,
  hasMenu,
  siblingNames,
  onHover,
  onToggle,
  onMenu,
  onRename,
  onCancelRename,
}: {
  node: FolderNode;
  open: boolean;
  editing: boolean;
  active: boolean;
  hasMenu: boolean;
  siblingNames: string[];
  onHover: (on: boolean) => void;
  onToggle: () => void;
  onMenu: (event: React.MouseEvent) => void;
  onRename: (name: string) => Promise<void>;
  onCancelRename: () => void;
}) {
  return (
    <li role="treeitem" aria-expanded={open}>
      {editing ? (
        <FolderNameField depth={node.depth} initial={node.name} siblingNames={siblingNames} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <div
          tabIndex={0}
          style={{ paddingLeft: ROW_INDENT + node.depth * DEPTH_INDENT }}
          className={cn(ROW, "text-foreground hover:bg-accent/50")}
          onClick={onToggle}
          onContextMenu={(event) => {
            if (!hasMenu) return;
            event.preventDefault();
            onMenu(event);
          }}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggle();
            }
          }}
        >
          <ChevronRight size={12} className={cn("shrink-0 text-muted-foreground transition-transform duration-[120ms]", open && "rotate-90")} />
          <Folder size={13} className="shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{node.name}</span>
          {/* A folder row carries nothing on the right, which is what frees that
              edge for the hover actions and keeps long names legible. */}
          <span className="flex w-6 shrink-0 items-center justify-end">
            {active && hasMenu && <RowAction icon={Ellipsis} label={`Actions for ${node.name}`} onClick={onMenu} />}
          </span>
        </div>
      )}
    </li>
  );
}

function NewFolderRow({
  depth,
  siblingNames,
  onCommit,
  onCancel,
}: {
  depth: number;
  siblingNames: string[];
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <li role="treeitem">
      <FolderNameField depth={depth} initial="untitled folder" siblingNames={siblingNames} onCommit={onCommit} onCancel={onCancel} />
    </li>
  );
}

/**
 * Naming a folder is no dialog: the row is a real row from the first keystroke,
 * so you can see where it lands while you type. Enter creates the directory,
 * Esc or an empty name cancels, and a duplicate refuses Enter and says so.
 */
function FolderNameField({
  depth,
  initial,
  siblingNames,
  onCommit,
  onCancel,
}: {
  depth: number;
  initial: string;
  siblingNames: string[];
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const error = folderNameError(name, siblingNames);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = async () => {
    if (error || busy) return;
    setBusy(true);
    try {
      await onCommit(name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-6 items-center gap-1.5 pr-2" style={{ paddingLeft: ROW_INDENT + depth * DEPTH_INDENT }}>
      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
      <Folder size={13} className="shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={name}
        title={error}
        aria-label="Folder name"
        aria-invalid={error !== undefined}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commit().catch(onCancel)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className={cn(
          "h-5 min-w-0 flex-1 rounded-sm border bg-background px-1 text-[13px] text-foreground outline-none",
          error ? "border-destructive" : "border-ring",
        )}
      />
    </div>
  );
}

function FileRow({
  script,
  depth,
  suffix,
  current,
  running,
  agent,
  waiting,
  active,
  hasMenu,
  onHover,
  onSelect,
  onMenu,
}: {
  script: Script;
  depth: number;
  // The folder, shown dim beside the name in a flattened filter result.
  suffix?: string;
  current: boolean;
  running?: boolean;
  agent?: boolean;
  waiting?: boolean;
  active: boolean;
  hasMenu: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onMenu: (event: React.MouseEvent) => void;
}) {
  const { base, extension } = scriptNameParts(script.name);

  return (
    <li role="treeitem" aria-current={current || undefined}>
      <div
        tabIndex={0}
        style={{ paddingLeft: ROW_INDENT + depth * DEPTH_INDENT + CHEVRON_SLOT }}
        className={cn(ROW, current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50")}
        onClick={onSelect}
        onContextMenu={(event) => {
          if (!hasMenu) return;
          event.preventDefault();
          onMenu(event);
        }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        {/* The same font as a draft, a folder and the app tree below — one
            list of names. The extension is the same three characters on every
            row, so it is dimmed rather than shouted or dropped: the row still
            reads as a file, and the UI font is narrower, so more of a long name
            survives the truncation. */}
        <span className="flex-1 truncate">
          {base}
          {extension && <span className="text-muted-foreground">{extension}</span>}
          {suffix && <span className="ml-1.5 text-xs text-muted-foreground">{suffix}</span>}
        </span>
        <RowTrailing running={running} agent={agent} waiting={waiting} wide={false}>
          {active && hasMenu && <RowAction icon={Ellipsis} label={`Actions for ${script.name}`} onClick={onMenu} />}
        </RowTrailing>
      </div>
    </li>
  );
}

/**
 * A row's right edge. It is a fixed width whatever is in it, so a label's
 * truncation point doesn't shift as a run starts under the cursor or a kebab
 * appears — the one row that carries three buttons widens the slot instead.
 *
 * Only the run indicators live here now: the amber dot went with the drafts /
 * files split, and a file auto-saves, so there is no unsaved state to mark.
 * Nothing in this region is a warning.
 */
function RowTrailing({
  running,
  agent,
  waiting,
  wide,
  children,
}: {
  running?: boolean;
  agent?: boolean;
  waiting?: boolean;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <span className={cn("flex shrink-0 items-center justify-end gap-0.5", wide ? "w-auto" : "w-6")}>
      {children ||
        (waiting ? (
          <span aria-hidden title="Waiting for an answer" className="size-[5px] rounded-full bg-amber-500 ring-[3px] ring-amber-500/25" />
        ) : running ? (
          <span className="flex" title={agent ? "An agent is running this" : "Running"}>
            <Spinner className="size-3" />
          </span>
        ) : null)}
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

// Every menu in this region is anchored at the cursor, so they share the plumbing.
function CursorMenu({
  at,
  onClose,
  width = "w-48",
  children,
}: {
  at: { top: number; left: number } | null;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} style={{ position: "fixed", top: at?.top ?? 0, left: at?.left ?? 0, width: 1, height: 1, pointerEvents: "none" }} />
      <DropdownMenu open={at !== null} onOpenChange={(open) => !open && onClose()}>
        <DropdownMenuContent align="start" anchor={anchor} className={width}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Filtering matches both groups at once and flattens each: a tree of one match
// per branch is a worse answer than a list.
function filterAll(scripts: Script[], drafts: Draft[], query: string): { scripts: Script[]; drafts: Draft[] } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { scripts, drafts };
  return {
    scripts: filterScripts(scripts, query),
    drafts: drafts.filter((draft) => draft.title.toLowerCase().includes(needle)),
  };
}

function childFolderNames(tree: TreeNode[], parent: string): string[] {
  const find = (nodes: TreeNode[]): TreeNode[] => {
    if (parent === "") return nodes;
    for (const node of nodes) {
      if (node.kind !== "folder") continue;
      if (node.path === parent) return node.children;
      const found = find(node.children);
      if (found.length > 0) return found;
    }
    return [];
  };
  return find(tree)
    .filter((node): node is FolderNode => node.kind === "folder")
    .map((node) => node.name);
}

// The names a rename is checked against: everything beside it, itself excluded.
function siblingFolderNames(tree: TreeNode[], path: string): string[] {
  const at = path.lastIndexOf("/");
  const parent = at === -1 ? "" : path.slice(0, at);
  const self = path.slice(at + 1);
  return childFolderNames(tree, parent).filter((name) => name !== self);
}
