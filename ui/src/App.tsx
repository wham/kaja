import { useMediaQuery } from "./useMediaQuery";
import { Alert } from "./components/alert";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { Button } from "./components/button";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { Braces, Code, FileCode, Folder, PenLine, Plug, Save as SaveIcon, ScrollText, X } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "./cn";
import { CommandRow } from "./CommandRow";
import { Console } from "./Console";
import { newRunId, Run } from "./runs";
import { consoles, FileConsole } from "./consoles";
import { dropStoredFile, loadRuns, renameStoredFile, saveRuns } from "./runStore";
import { NoFileBlankslate, RecentFile } from "./NoFileBlankslate";
import { CompileLog } from "./CompileLog";
import { Definition } from "./Definition";
import { Destination, Finder } from "./Finder";
import { Splitter } from "./Splitter";
import { answerPlaceholder, answerProblem, normalizeAnswer } from "./ask";
import { ApproveBlock, ApproveGesture, AskBlock, Block, blockLabel, CellStatus, TableBlock } from "./blocks";
import { ApprovalRejectedError, ApproveDecision, AskCancelledError, Kaja, KajaHost, MethodCall } from "./kaja";
import { CellRef, TableView } from "./tableView";
import { appHeaders, appParameters, appType, buildApp } from "./appTypes";
import { createPendingApp, getDefaultMethod, Method, App as AppModel, Script, scriptName, Service, updateAppRef } from "./apps";
import {
  appendCall,
  createDraft,
  editedDrafts,
  findUntouched,
  isAgentDraft,
  isUntouched,
  markRun,
  pruneDrafts,
  reopen,
  Draft,
  takeOver,
  untouchedDrafts,
  withCode,
} from "./drafts";
import { deriveDraftTitle, proposeFileName, proposeFileNames } from "./draftTitle";
import { hasMultiplePackages, methodUse, recordUse } from "./treeExpansion";
import { generateMethodEditorCode } from "./appLoader";
import { agentSession } from "./agentSession";
import { buildMcpCatalog } from "./mcpCatalog";
import { classifyFailure } from "./callFailure";
import { RunButton } from "./RunButton";
import { useSyntaxErrors } from "./syntaxErrors";
import { Sidebar, TRAFFIC_LIGHTS_INSET } from "./Sidebar";
import { ScriptsRegion } from "./ScriptsRegion";
import { NewAppDialog } from "./NewAppDialog";
import { StatusBar, ColorMode } from "./StatusBar";
import { FeaturePreview } from "./FeaturePreviews";
import { AppForm } from "./AppForm";
import { Editor, registerKajaModule, setValueCompletionApps } from "./Editor";
import { formatTypeScript } from "./formatter";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { logFileLevel } from "./scriptConsole";
import { logScriptLine } from "./uiLog";
import { Configuration, ConfigurationApp, LogLevel, Runtime, VariableStatus } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  dropView,
  persistedDraftId,
  PersistedViewState,
  restoreViews,
  serializeViews,
  setAppFormEditMode,
  setVariablesEditMode,
  showAppForm,
  showCompiler,
  showDefinition,
  showDraft,
  showScript,
  showVariables,
  View,
  viewIdentity,
  visit,
} from "./views";
import { Variables, VariablesSave, VariablesState } from "./Variables";
import { useCompilation } from "./useCompilation";
import { useConfigurationChanges } from "./useConfigurationChanges";
import { usePersistedState } from "./usePersistedState";
import { setVariables, variableReferences } from "./variableExpansion";
import { flushPersistedWrites, getPersistedValue, setPersistedValue } from "./storage";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { isWailsEnvironment } from "./wails";
import { EventsEmit, EventsOn, WindowSetTitle } from "./wailsjs/runtime";
import {
  canWriteScripts,
  createScriptFile,
  createScriptFolder,
  deleteScriptFile,
  deleteScriptFolder,
  listScriptFiles,
  listScriptFolders,
  readScriptFile,
  renameScriptFile,
  renameScriptFolder,
  writeScriptFile,
} from "./scriptFiles";
import { hasScriptLink, isLinkedScript, parseScriptLink } from "./scriptLink";
import { readInputKeys } from "./scriptInputs";
import { useInputKeys } from "./useInputKeys";
import { lastRunInput, moveRunInput, rememberRunInput } from "./runInput";
import { ParameterSheet } from "./ParameterSheet";
import { FileName } from "./FileName";
import { MCPScriptResult, MCPServerInfo, MCPSetCatalog, ResolvedVariables, ScriptsFolder, ShowFileInFinder } from "./wailsjs/go/main/App";
import { main } from "./wailsjs/go/models";
import { runScript, runScriptCaptured } from "./scriptRunner";

// How long a discarded draft is held before it is really gone. Nothing was on
// disk, so this is undo rather than a confirmation.
const UNDO_DISCARD_MS = 8000;

// How long the footer keeps saying the MCP server is in use after the last
// request was answered. A burst of calls is over in milliseconds, so without it
// the indicator would be gone before it was seen.
const MCP_ACTIVITY_LINGER_MS = 2500;

// Draft ids the last session had open, so start-up pruning can't drop one
// that is about to reopen.
function openDraftIds(): string[] {
  const persisted = getPersistedValue<PersistedViewState>("views");
  return (persisted?.views ?? []).flatMap((view) => {
    const id = persistedDraftId(view);
    return id === undefined ? [] : [id];
  });
}

/**
 * The pile, read back. Drafts were called scratches in the code until the UI's
 * word won, so the key they were written under is read once more: a rename is
 * not a reason to lose somebody's work.
 */
function persistedDrafts(): Draft[] {
  return getPersistedValue<Draft[]>("drafts") ?? getPersistedValue<Draft[]>("scratches") ?? [];
}

// Vertical padding the editor reserves around the code (see Editor.tsx).
const EDITOR_PADDING = 32;
// Bounds for the editor pane in the top-bottom layout. The maximum is a share of
// the window so a long script can't push the response off screen.
const MIN_EDITOR_HEIGHT = 120;
const MAX_EDITOR_HEIGHT_RATIO = 0.55;
// Above this window width the editor and the response fit side by side, which
// suits the wide, short shape of a method call better than stacking them. Side
// by side splits the window three ways — sidebar, editor, response — so the
// threshold has to leave the response a usable share of it; below this, stacking
// gives it the full width instead.
const SIDE_BY_SIDE_MIN_WIDTH = 1600;

// What the sidebar reads off every file's console: which are running, which an
// agent is driving, and which are stopped on a question. Three booleans, so a
// flip is rare and a call never touches them.
const subscribeConsoleFlags = (notify: () => void) => consoles.subscribeFlags(notify);
const consoleFlagsVersion = () => consoles.flagsVersion();

// Compare the parts of an app's configuration that require recompilation when
// changed: its type and parameters. Headers are excluded.
function appNeedsRecompile(a: ConfigurationApp, b: ConfigurationApp): boolean {
  return appType(a) !== appType(b) || JSON.stringify(appParameters(a)) !== JSON.stringify(appParameters(b));
}

// Parameters may reference ${NAME} variables, expanded when the app is opened,
// so a changed variable also forces a recompile. Headers are excluded here too;
// they are expanded per request.
function appReferencesChangedVariable(app: ConfigurationApp, previous: { [key: string]: string }, next: { [key: string]: string }): boolean {
  return Object.values(appParameters(app)).some((value) => variableReferences(value).some((name) => previous[name] !== next[name]));
}

// Helper: Apply rename to an app (remap sources and services)
function applyAppRename(app: AppModel, newConfig: ConfigurationApp): AppModel {
  const originalName = app.configuration.name;
  const remappedSources = remapSourcesToNewName(app.sources, originalName, newConfig.name);
  const remappedServices = app.services.map((service) => ({
    ...service,
    sourcePath: newConfig.name + service.sourcePath.slice(originalName.length),
  }));
  // Update the existing appRef in place so clients use new values
  updateAppRef(app.appRef, newConfig);
  return {
    ...app,
    configuration: newConfig,
    sources: remappedSources,
    services: remappedServices,
  };
}

/**
 * A run in flight, and the `Kaja` its script is running against. The two are
 * made together and let go together: once a run has settled and nothing it
 * started is still in the air, dropping this record is what releases the run's
 * approvals, its sampled methods, its bound clients and its console closures.
 * The only thing that can hold the `Kaja` past that is a live table the canvas
 * can still page, and that registry is bounded at MAX_LIVE_TABLES — so a run's
 * context lives exactly as long as something can call into it.
 */
interface LiveRun {
  run: Run;
  kaja: Kaja;
  controller?: AbortController;
  // The script itself has returned. Its calls may still be landing.
  settled: boolean;
}

// Where a run being watched over MCP collects what it did, so the report is
// built from this run's own calls and blocks rather than from whatever was in
// flight when it finished.
/**
 * What the naming sheet holds. Three verbs, one shape: naming a draft, renaming
 * a file and moving one are the same write, because a file's path is its name.
 */
interface NameSheet {
  verb: "name" | "rename" | "move";
  title: string;
  name: string;
  folder: string;
  // The draft being named, and its code.
  content?: string;
  draftId?: string;
  // The file being renamed or moved.
  script?: Script;
}

// Files read in the order the sidebar draws them: by folder, then by name.
function sortScripts(scripts: Script[]): Script[] {
  return [...scripts].sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

interface RunCollector {
  calls: MethodCall[];
  blocks: Map<string, Block>;
}

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  // The running kaja, as opposed to the workspace it serves. It arrives alongside
  // the configuration but is not part of it, and holds until the process exits.
  const [runtime, setRuntime] = useState<Runtime>(Runtime.create());
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  // Where each variable's value came from. A value the configuration only names
  // never travels, so this is all the Variables view knows about it.
  const [variableStatus, setVariableStatus] = useState<VariableStatus[]>([]);
  // What the Variables view holds that nothing else does: whether it is dirty,
  // whether it could save, and how to make it. Nothing reads any of it: the tab
  // strip that marked the dot and the close gesture that offered the save are
  // both gone, so this and `Variables.onStateChange` are dead until something
  // wants them again.
  const [variablesState, setVariablesState] = useState<VariablesState>({ dirty: false, canSave: false, save: async () => {} });
  const variablesStateRef = useRef(variablesState);
  variablesStateRef.current = variablesState;
  const [apps, setApps] = useState<AppModel[]>([]);
  // Every draft ever made, newest activity first — unlimited, kept in the
  // app, named from its own code. Independent of what is open: closing a view
  // puts a draft away, it doesn't throw it out.
  // The weekly sweep of untouched drafts. It is what keeps an unlimited pile —
  // one row per method clicked — at a steady size, and it is read here before
  // anything else because start-up is when it runs.
  const [sweepDrafts, setSweepDrafts] = usePersistedState("sweepDrafts", true);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    pruneDrafts(persistedDrafts(), Date.now(), new Set(openDraftIds()), getPersistedValue<boolean>("sweepDrafts") ?? true),
  );
  // The open files, most-recently-visited first: views[0] is what the window is
  // showing. Nothing else records which file is current.
  const [views, setViews] = useState<View[]>(() => restoreViews(getPersistedValue<PersistedViewState>("views"), persistedDrafts()));
  // A tree of names at 22px a row needs less width than one of icons at 34px.
  const [sidebarWidth, setSidebarWidth] = usePersistedState("sidebarWidth", 240);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("sidebarCollapsed", false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const [editorHeight, setEditorHeight] = usePersistedState("editorHeight", 400);
  // Until the gutter is dragged, the editor pane is sized to the code it holds
  // rather than to a fixed split — a three-line call shouldn't reserve half the
  // window. Dragging switches to the manual editorHeight for good.
  const [editorHeightAuto, setEditorHeightAuto] = usePersistedState("editorHeightAuto", true);
  const editorHeightAutoRef = useRef(editorHeightAuto);
  editorHeightAutoRef.current = editorHeightAuto;
  const [editorContentHeights, setEditorContentHeights] = useState<{ [viewId: string]: number }>({});
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [editorWidth, setEditorWidth] = usePersistedState("editorWidth", 600);
  const [editorLayout, setEditorLayout] = usePersistedState<"vertical" | "horizontal">("editorLayout", () =>
    window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH ? "horizontal" : "vertical",
  );
  const [colorMode, setColorMode] = usePersistedState<ColorMode>("colorMode", "night");
  /**
   * Every file's console lives in `consoles`, not here. A run writes to it two
   * or three times per call, and a thousand-call run that wrote each of those
   * into state at this level would render the whole window — sidebar, command
   * row, every mounted view and the editor with them — a few thousand times.
   * Only the console subscribes to it, and only on the frame.
   */
  useSyncExternalStore(subscribeConsoleFlags, consoleFlagsVersion);
  // Whether the finder is open, and where it opened: ⌘P lands on the previous
  // file so ⌘P⏎ goes back, a click on the trigger on the first row.
  const [finder, setFinder] = useState<"first" | "previous">();
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const editorRegistryRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());
  const hasViewMemory = useRef(getPersistedValue<PersistedViewState>("views") !== undefined);
  const viewsRestoredRef = useRef(views.some((view) => view.type === "draft"));
  const [scripts, setScripts] = useState<Script[]>();
  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;
  // Every directory under the scripts root. A folder holding nothing has no file
  // to be inferred from, and it persists all the same — it is a directory, not a
  // UI grouping.
  const [scriptFolders, setScriptFolders] = useState<string[]>([]);
  // "Preview Apps" toggle: reveals the experimental built-in app types in the New
  // dialog (openapi/openai/folder). gRPC/Twirp are always available.
  const [previewApps, setPreviewApps] = usePersistedState("featurePreview:previewApps", false);
  const previewAppsRef = useRef(previewApps);
  previewAppsRef.current = previewApps;
  // The MCP server (desktop only) exposes script edit/run and the service catalog
  // to an agent over a localhost endpoint. It runs for as long as the process
  // does, so all the UI has of it is what to show in the footer.
  const [mcpInfo, setMcpInfo] = useState<main.MCPInfo | undefined>();
  // Whether an agent is using the server right now, which the footer's plug
  // shows. It outlives the request that set it (see MCP_ACTIVITY_LINGER_MS).
  const [mcpActive, setMcpActive] = useState(false);
  // On the web the same footer reads the session this browser holds instead: the
  // MCP server is here too, but the window has to offer itself before there is
  // anything to connect to.
  const agentState = useSyncExternalStore(agentSession.subscribe, agentSession.getState);
  const mcpConnection = useMemo(() => {
    if (isWailsEnvironment()) return mcpInfo;
    if (!agentState.connected || !agentState.url || !agentState.token) return undefined;
    return { enabled: true, url: agentState.url, token: agentState.token, error: "" };
  }, [mcpInfo, agentState.connected, agentState.url, agentState.token]);
  const agentFooter = useMemo(
    () =>
      isWailsEnvironment() || !agentState.available
        ? undefined
        : {
            connected: agentState.connected,
            attached: agentState.attached,
            onDuty: agentState.onDuty,
            error: agentState.error,
            connect: () => agentSession.connect(),
            disconnect: () => agentSession.disconnect(),
          },
    [agentState.available, agentState.connected, agentState.attached, agentState.onDuty, agentState.error],
  );
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const [fileError, setFileError] = useState<string | undefined>();
  /**
   * The naming sheet: a name and a folder, and nothing else. It is one sheet for
   * three moments, because on disk they are one operation — a file's path is its
   * name, so naming a draft, renaming a file and moving one all write the same
   * two fields.
   *
   * Naming a draft is what moves it into Files: the draft it came from goes away
   * with it, the same buffer now on disk.
   */
  const [nameSheet, setNameSheet] = useState<NameSheet | null>(null);
  const [nameSheetError, setNameSheetError] = useState<string>();
  // Active `kaja.ask*` prompt; null when no script is waiting for input. The
  // question travels as its block, because what is being asked for decides what
  // the dialog draws — the same reading the canvas makes of the same block.
  const [askPrompt, setAskPrompt] = useState<{
    question: AskBlock;
    value: string;
    problem?: string;
    resolve: (value: string) => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  // Active `kaja.approve(...)` call, for a run with no canvas to draw it on;
  // null when nothing is waiting to be approved.
  const [approvePrompt, setApprovePrompt] = useState<{
    call: ApproveBlock;
    resolve: (decision: ApproveDecision) => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  // Whether the New app dialog is open.
  const [newAppOpen, setNewAppOpen] = useState(false);
  // Whether the active view's JSON parses. It gates switching back to the form or
  // the table, which is why it lives out here with the control that does the
  // switch.
  const [viewJsonValid, setViewJsonValid] = useState(true);
  const viewJsonValidRef = useRef(viewJsonValid);
  viewJsonValidRef.current = viewJsonValid;
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // One-shot signal to expand an app's logs when the compile log is opened for it.
  const [compileLogExpandApp, setCompileLogExpandApp] = useState<{ name: string }>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null);
  // Clearing the pile of drafts, confirmed only when it costs something: the
  // dialog appears when work would go, and names it. Nothing here can reach a
  // file.
  const [clearAllPrompt, setClearAllPrompt] = useState<{ all: Draft[]; edited: Draft[] } | null>(null);
  // A `kaja://run/…` deeplink that arrived and is waiting to be let through.
  const [linkPrompt, setLinkPrompt] = useState<{ script: Script; input: { [key: string]: string } } | null>(null);
  // The deeplink a script is being copied from, and the parameters it takes.
  const [linkSheet, setLinkSheet] = useState<{ script: Script; parameters: string[] } | null>(null);
  // The run a deeplink started, waiting to be shown. Nobody pressed Run for it —
  // it arrived from a launcher, a hotkey or a Shortcut — so what it draws takes
  // the window rather than sitting in a panel behind the editor. The console
  // hands it back once it has been shown, and once it is clear it never will be.
  const [presentRunId, setPresentRunId] = useState<string>();
  // Run, asking for `kaja.input` first. The same sheet the deeplink doors use,
  // minus the URL — which is what makes a script written for a deeplink whole
  // to run in the app.
  const [runPrompt, setRunPrompt] = useState<{ fileId: string; fileName: string; parameters: string[] } | null>(null);
  /**
   * The runs in flight. There is more than one because there is nothing to stop
   * there being: ⌘⏎ twice, Run on a second file, a `kaja://` link arriving while
   * a script is going, an agent calling `run_script` — all of them start a run
   * without asking what else is going. So a run is a member of a list rather
   * than the contents of a slot, and each carries the `Kaja` its script is
   * running against, which is what keeps two of them from meeting.
   *
   * `settled` marks the script itself as finished — the run is only over once
   * its calls have landed too, which is what `settleIfQuiet` waits for.
   */
  const [activeRuns, setActiveRuns] = useState<LiveRun[]>([]);
  const activeRunsRef = useRef(activeRuns);
  activeRunsRef.current = activeRuns;
  // A discarded draft, held long enough to take it back. Nothing was on disk,
  // so discarding is undoable rather than confirmed.
  const [discarded, setDiscarded] = useState<{ drafts: { draft: Draft; runs?: FileConsole }[]; label: string } | null>(null);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending debounced disk writes for open script views, keyed by view id.
  const scriptSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Tab ids whose next content change is a programmatic revalidation poke (see
  // refreshOpenScriptEditors) or text that just came off disk, not a user edit —
  // skip the debounced disk save.
  const suppressScriptSave = useRef(new Set<string>());
  // Pending debounced writes of draft text back to the store, keyed by draft id.
  const draftSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const showFileError = useCallback((message: string) => {
    setFileError(message);
    window.setTimeout(() => setFileError((current) => (current === message ? undefined : current)), 4000);
  }, []);

  const persistViews = useCallback(() => {
    setPersistedValue(
      "views",
      serializeViews(viewsRef.current, (viewId) => editorRegistryRef.current.get(viewId)?.saveViewState()),
    );
  }, []);

  // Every change to a draft goes through here: the list is kept newest-first
  // and written straight through, because a draft has no save step — it is
  // already kept.
  const applyDrafts = useCallback((update: (drafts: Draft[]) => Draft[]) => {
    const next = update(draftsRef.current);
    if (next === draftsRef.current) return;
    const ordered = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    draftsRef.current = ordered;
    setDrafts(ordered);
    setPersistedValue("drafts", ordered);
  }, []);

  const updateDraft = useCallback(
    (id: string, change: (draft: Draft) => Draft) => {
      applyDrafts((list) => {
        const index = list.findIndex((draft) => draft.id === id);
        return index === -1 ? list : list.map((draft, i) => (i === index ? change(draft) : draft));
      });
    },
    [applyDrafts],
  );

  // Flush a script view's pending debounced write immediately (e.g. before its
  // model is disposed). No-op if nothing is pending.
  const flushScriptWrite = useCallback(
    (view: View) => {
      if (view.type !== "script" || !canWriteScripts()) return;
      const timer = scriptSaveTimers.current.get(view.id);
      if (!timer) return;
      clearTimeout(timer);
      scriptSaveTimers.current.delete(view.id);
      writeScriptFile(view.script, view.model.getValue()).catch((err) => showFileError(`Save failed: ${err}`));
    },
    [showFileError],
  );

  const disposeView = useCallback(
    (view: View) => {
      if (view.type !== "draft" && view.type !== "script") return;
      flushScriptWrite(view);
      editorRegistryRef.current.delete(view.id);
      setEditorContentHeights(({ [view.id]: _removed, ...rest }) => rest);
      view.model.dispose();
    },
    [flushScriptWrite],
  );

  // Every change to the open files goes through here, which makes this the one
  // place that has to remember the rest: the file being left keeps its cursor,
  // whatever left the list is disposed, and the new list is persisted.
  const applyViews = useCallback(
    (update: (views: View[]) => View[]) => {
      const previous = viewsRef.current;
      const current = previous[0];
      if (current?.type === "draft" || current?.type === "script") {
        const editor = editorRegistryRef.current.get(current.id);
        if (editor) current.viewState = editor.saveViewState() ?? undefined;
      }

      const next = update(previous);
      if (next === previous) return;

      const kept = new Set(next.map((view) => view.id));
      for (const view of previous) {
        if (!kept.has(view.id)) disposeView(view);
      }

      viewsRef.current = next;
      setViews(next);
      persistViews();
    },
    [disposeView, persistViews],
  );

  /**
   * A `kaja.ask*` is answered, and a `kaja.approve(...)` decided, on the canvas
   * of the run it came from — so both promises wait here keyed by the block they
   * were drawn as. One map, because both are the same thing to the run: it is
   * parked until someone says something. A run with no console has no canvas to
   * draw on and falls back to a dialog, which needs no surface of its own.
   *
   * Each entry remembers which run is parked on it, because Stop is about one
   * run: cancelling every question on screen would stop a script the button was
   * never pointing at.
   */
  const pendingPromptsRef = useRef(new Map<string, { runId: string; resolve: (answer: string) => void; reject: (error: unknown) => void }>());

  const settlePrompt = useCallback((blockId: string, settle: (pending: { resolve: (answer: string) => void; reject: (error: unknown) => void }) => void) => {
    const pending = pendingPromptsRef.current.get(blockId);
    if (!pending) return;
    pendingPromptsRef.current.delete(blockId);
    settle(pending);
  }, []);

  // What every run is built from and what outlives them all: the workspace's
  // variables, and the live tables, which are paged from the canvas long after
  // the run that drew them has ended.
  const hostRef = useRef<KajaHost>(null);
  if (!hostRef.current) {
    hostRef.current = new KajaHost();
  }
  const host = hostRef.current;

  /**
   * Open a run, and with it the `Kaja` its script will be handed.
   *
   * This is the one place a run is created, and everything the script goes on to
   * do — a call, a printed line, a block, a question — is routed by a closure
   * over the run made here. That is the whole of how two scripts running at once
   * stay apart: there is no "current run" to read, so there is nothing to read
   * wrongly. A page fetched from a table's canvas long after the run ended goes
   * through the same closures, which is why it still lands in the right log.
   */
  const beginRun = useCallback(
    (
      title: string,
      fileId?: string,
      controller?: AbortController,
      options?: { origin?: Run["origin"]; input?: { [key: string]: string }; collect?: RunCollector },
    ): LiveRun => {
      const run: Run = { id: newRunId(), title, fileId, startedAt: Date.now(), origin: options?.origin };
      consoles.startRun(run, run.startedAt);

      const collect = options?.collect;
      const kaja = host.run({
        input: options?.input,
        onMethodCallUpdate: (methodCall: MethodCall) => {
          // A run being watched by an agent rather than a person reports its
          // calls back as well as recording them; the collector is this run's,
          // so a second run in flight cannot write into it.
          if (collect) {
            const i = collect.calls.findIndex((m) => m.id === methodCall.id);
            if (i > -1) collect.calls[i] = methodCall;
            else collect.calls.push(methodCall);
          }
          // A call a script actually made counts as much as one picked out of the
          // tree, and more of them are made this way once you are working.
          recordUse(methodUse(methodCall.appName, methodCall.service, methodCall.method));
          consoles.recordCall(run.fileId, run.id, methodCall, Date.now());
        },
        /**
         * A line the script printed. It lands in the run it was printed in, so it
         * can be read against the calls around it, and in kaja.log with its
         * origin attached — the file is what a TestFlight user can actually send
         * back.
         *
         * It is not a verdict: an error-level line says something went wrong in
         * the script's own reckoning, not that the run failed, so it never
         * colours the run's dot. Only `reportScriptError` does that.
         */
        onLog: (level: LogLevel, message: string) => {
          logScriptLine(logFileLevel(level), message);
          consoles.recordPrinted(run.fileId, run.id, level, message, Date.now());
        },
        // Something the script drew. Blocks arrive more than once — a table
        // paints row by row — so they are recorded against their own id rather
        // than appended.
        onBlockUpdate: (blockId: string, block: Block) => {
          collect?.blocks.set(blockId, block);
          consoles.recordBlock(run.fileId, run.id, blockId, block, Date.now());
        },
        onAsk: (question: AskBlock, blockId: string) =>
          new Promise<string>((resolve, reject) => {
            if (!run.fileId) {
              // A select opens on its first option, since the dialog has one
              // field and it has to hold something.
              setAskPrompt({ question, value: question.answerType === "select" ? (question.choices?.[0] ?? "") : "", resolve, reject });
              return;
            }
            pendingPromptsRef.current.set(blockId, { runId: run.id, resolve, reject });
          }),
        onApprove: (call: ApproveBlock, blockId: string) =>
          new Promise<ApproveDecision>((resolve, reject) => {
            if (!run.fileId) {
              setApprovePrompt({ call, resolve, reject });
              return;
            }
            // The gesture rides back on the same map an answer does — there is one
            // thing to say, and which of the two approvals it was is the whole of it.
            pendingPromptsRef.current.set(blockId, {
              runId: run.id,
              resolve: (gesture) => resolve(gesture === "all" ? "all" : "approved"),
              reject,
            });
          }),
      });

      const live: LiveRun = { run, kaja, controller, settled: false };
      setActiveRuns((runs) => [...runs, live]);
      return live;
    },
    [host],
  );

  const beginRunRef = useRef(beginRun);
  beginRunRef.current = beginRun;

  // The script has returned. Its calls may still be landing, so this is not the
  // run being over — `settleIfQuiet` decides that once nothing it started is in
  // the air.
  const markSettled = useCallback((runId: string) => {
    setActiveRuns((runs) => runs.map((live) => (live.run.id === runId ? { ...live, settled: true } : live)));
  }, []);

  const markSettledRef = useRef(markSettled);
  markSettledRef.current = markSettled;

  // Show a failed script run in the console; a script that dies silently looks
  // like it succeeded. Mirrored to console.error so it also lands in kaja.log.
  // It takes the run rather than finding one: the script that failed is the one
  // whose error this is, however many others are going.
  const reportScriptError = useCallback(
    (run: Run) => (error: unknown) => {
      console.error("Script error:", error);
      const message = error instanceof Error ? (error.name === "Error" ? error.message : `${error.name}: ${error.message}`) : String(error);
      consoles.recordLogs(run.fileId, run.id, [{ level: LogLevel.LEVEL_ERROR, message }], Date.now());
    },
    [],
  );

  const onAnswerAsk = useCallback((blockId: string, answer: string) => settlePrompt(blockId, (pending) => pending.resolve(answer)), [settlePrompt]);
  const onCancelAsk = useCallback((blockId: string) => settlePrompt(blockId, (pending) => pending.reject(new AskCancelledError())), [settlePrompt]);

  // Approve sends the call, Approve all sends it and every later one to the same
  // method, and Stop rejects it, which stops the script where it stands. The
  // block records which of the three happened either way.
  const onDecideApproval = useCallback(
    (blockId: string, gesture: ApproveGesture) =>
      settlePrompt(blockId, (pending) => (gesture === "rejected" ? pending.reject(new ApprovalRejectedError()) : pending.resolve(gesture))),
    [settlePrompt],
  );

  // The dialog checks the answer the way the canvas does, so the same question
  // is as hard to answer wrongly here as it is there.
  const submitAskPrompt = useCallback(() => {
    if (!askPrompt) return;
    const problem = answerProblem(askPrompt.question.answerType, askPrompt.value);
    if (problem) {
      setAskPrompt({ ...askPrompt, problem });
      return;
    }
    askPrompt.resolve(normalizeAnswer(askPrompt.question.answerType, askPrompt.value));
    setAskPrompt(null);
  }, [askPrompt]);

  /**
   * Where each table is paged and searched. This is view state rather than
   * something the run drew, so it is held here instead of in the block — but
   * above the console, so switching to the log and back finds the table where it
   * was left.
   */
  const [tableViews, setTableViews] = useState<{ [blockId: string]: TableView }>({});

  const onTableView = useCallback((blockId: string, view: TableView) => {
    setTableViews((current) => ({ ...current, [blockId]: view }));
  }, []);

  /**
   * Fill a live table further — the next page, or the first page of a new
   * search. A source that is no longer held (a run read back from an earlier
   * session, or one let go to keep the closures bounded) can't be pulled, and
   * the table says so rather than offering a Next that leads nowhere.
   *
   * Nothing here says which run the fetch belongs to: the host routes the block
   * to the `Kaja` that drew it, so the calls are recorded by that run's own
   * closures however long ago it ended, and a script running right now can't be
   * mistaken for the one being paged.
   */
  const onTablePull = useCallback(async (blockId: string, search: string, want: number) => {
    const found = consoles.findBlock(blockId);
    const table = found?.block;
    if (!found || table?.kind !== "table") return;

    const live = await hostRef.current!.pullTable(blockId, search, want);
    if (!live) {
      consoles.recordBlock(found.fileId, found.run.id, blockId, { ...table, live: false, expired: true }, Date.now());
    }
  }, []);

  /**
   * Start the cells a table is drawing — or retry one that stopped. The same
   * shape as a pull, and for the same reason: the work belongs to the run whose
   * canvas asked for it, and a table whose closures are gone says so rather than
   * leaving a row of bars that will never fill.
   */
  const onTableCells = useCallback(async (blockId: string, cells: CellRef[]) => {
    const found = consoles.findBlock(blockId);
    const table = found?.block;
    if (!found || table?.kind !== "table") return;

    const held = await hostRef.current!.pullCells(blockId, cells);
    if (!held) {
      consoles.recordBlock(found.fileId, found.run.id, blockId, { ...table, expired: true }, Date.now());
    }
  }, []);

  // Clearing a file's history clears what is being held of it for next time too;
  // leaving yesterday's run behind would make "cleared" a half-truth.
  const onClearConsole = useCallback((fileId: string) => {
    consoles.clearFile(fileId, Date.now());
    dropStoredFile(fileId);
  }, []);

  // Kept in sync during render so the first drag can pick up wherever the gutter
  // currently sits instead of jumping to the stale manual height.
  const effectiveEditorHeightRef = useRef(editorHeight);

  const onEditorResize = useCallback((delta: number) => {
    if (editorHeightAutoRef.current) {
      editorHeightAutoRef.current = false;
      setEditorHeightAuto(false);
      setEditorHeight(Math.max(MIN_EDITOR_HEIGHT, effectiveEditorHeightRef.current + delta));
      return;
    }
    setEditorHeight((height) => Math.max(MIN_EDITOR_HEIGHT, height + delta));
  }, []);

  const onEditorWidthResize = useCallback((delta: number) => {
    setEditorWidth((width) => Math.max(200, width + delta));
  }, []);

  const onToggleEditorLayout = useCallback(() => {
    setEditorLayout((layout) => (layout === "vertical" ? "horizontal" : "vertical"));
  }, []);

  const onToggleColorMode = useCallback(() => {
    setColorMode((mode) => (mode === "night" ? "day" : "night"));
  }, []);

  // gRPC/Twirp/OpenAPI apps are always enabled; the Preview Apps toggle only
  // reveals the experimental built-in app types (openai/folder).
  const featurePreviews: FeaturePreview[] = [{ key: "previewApps", label: "Preview Apps", enabled: previewApps }];

  const onToggleFeaturePreview = useCallback((key: string) => {
    if (key === "previewApps") {
      setPreviewApps((enabled) => !enabled);
    }
  }, []);

  // Responsive layout: narrow (mobile) allows scrolling, regular/wide (desktop) is fixed
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const isDesktopMac = isWailsEnvironment() && navigator.platform.startsWith("Mac");
  const overflow = isNarrow ? "auto" : "hidden";
  const sidebarMinWidth = isNarrow ? 250 : 100;
  const mainMinWidth = isNarrow ? 300 : 0;

  // Dispose Monaco source models for an app
  const disposeMonacoModelsForApp = useCallback((appName: string) => {
    monaco.editor.getModels().forEach((model) => {
      if (model.uri.path.startsWith("/" + appName + "/")) {
        model.dispose();
      }
    });
  }, []);

  // Create Monaco source models for an app
  const createMonacoModelsForApp = useCallback((app: AppModel) => {
    app.sources.forEach((source) => {
      const uri = monaco.Uri.parse("ts:/" + source.path);
      const existingModel = monaco.editor.getModel(uri);
      if (!existingModel) {
        monaco.editor.createModel(source.file.text, "typescript", uri);
      } else {
        existingModel.setValue(source.file.text);
      }
    });
  }, []);

  // Refresh open task editors to trigger re-validation
  const refreshOpenDraftEditors = useCallback(() => {
    viewsRef.current.forEach((view) => {
      if (view.type === "draft") {
        const value = view.model.getValue();
        view.model.setValue(value);
      }
    });
  }, []);

  // Poke open script editors so TypeScript re-resolves service-module imports
  // (e.g. "app/service") once their backing source models exist. Script models
  // are frequently created (on view restore or open) before compilation produces
  // the service definitions, so the TS worker caches "cannot find module" and
  // never clears it on its own. Use an identity edit — not setValue — to keep
  // undo history, and suppress the auto-save it would otherwise trigger.
  const refreshOpenScriptEditors = useCallback(() => {
    viewsRef.current.forEach((view) => {
      if (view.type === "script") {
        // onDidChangeContent fires synchronously within pushEditOperations, so
        // bracketing the poke leaves the set empty afterwards — a later real
        // edit is never mistaken for a poke even if the edit fires no event.
        suppressScriptSave.current.add(view.id);
        view.model.pushEditOperations([], [{ range: view.model.getFullModelRange(), text: view.model.getValue() }], () => null);
        suppressScriptSave.current.delete(view.id);
      }
    });
  }, []);

  // Core function: Sync apps state from a new configuration
  // This is the single source of truth for app state changes
  const syncAppsFromConfiguration = useCallback(
    (
      newConfiguration: Configuration,
      prevApps: AppModel[],
      previousVariables: { [key: string]: string },
    ): { updatedApps: AppModel[]; removedNames: Set<string>; renames: Map<string, string> } => {
      const updatedApps: AppModel[] = [];
      const newVariables = newConfiguration.variables ?? {};
      // Reconciliation is a single app-vs-app pass keyed by name.
      const newApps = newConfiguration.apps || [];
      const newConfigByName = new Map(newApps.map((a) => [a.name, a]));
      const prevByName = new Map(prevApps.map((p) => [p.configuration.name, p]));

      // Find orphans (removed) and newcomers (added)
      const orphans = prevApps.filter((p) => !newConfigByName.has(p.configuration.name));
      const newcomerConfigs = newApps.filter((a) => !prevByName.has(a.name));

      // Detect renames: an orphan and a newcomer with the same type+parameters are
      // the same backing service under a new name, so the compiled app (and its
      // open editors) can be remapped instead of recompiled.
      const renameMap = new Map<string, AppModel>(); // newName -> oldApp
      for (const newcomer of newcomerConfigs) {
        const matchingOrphan = orphans.find(
          (orphan) => !appNeedsRecompile(orphan.configuration, newcomer) && !appReferencesChangedVariable(newcomer, previousVariables, newVariables),
        );
        if (matchingOrphan && !renameMap.has(newcomer.name)) {
          renameMap.set(newcomer.name, matchingOrphan);
          const idx = orphans.indexOf(matchingOrphan);
          if (idx !== -1) orphans.splice(idx, 1);
        }
      }

      // Process each app in the new configuration
      for (const newConfig of newApps) {
        const existingApp = prevByName.get(newConfig.name);
        const renamedFrom = renameMap.get(newConfig.name);

        if (renamedFrom) {
          // Rename: remap sources and services
          disposeMonacoModelsForApp(renamedFrom.configuration.name);
          const renamedApp = applyAppRename(renamedFrom, newConfig);
          createMonacoModelsForApp(renamedApp);
          updatedApps.push(renamedApp);
          continue;
        }

        if (!existingApp) {
          // New app
          updatedApps.push(createPendingApp(newConfig));
          continue;
        }

        if (appNeedsRecompile(existingApp.configuration, newConfig) || appReferencesChangedVariable(newConfig, previousVariables, newVariables)) {
          // Needs recompilation
          disposeMonacoModelsForApp(existingApp.configuration.name);
          updatedApps.push(createPendingApp(newConfig));
        } else {
          // Unchanged: keep the compiled app (and its invocation target),
          // refreshing forwarded headers in place.
          updateAppRef(existingApp.appRef, newConfig);
          updatedApps.push({ ...existingApp, configuration: newConfig });
        }
      }

      // Clean up removed apps
      const removedNames = new Set(orphans.map((p) => p.configuration.name));
      for (const orphan of orphans) {
        disposeMonacoModelsForApp(orphan.configuration.name);
      }

      // Build renames: oldName -> newName
      const renames = new Map<string, string>();
      for (const [newName, oldApp] of renameMap) {
        renames.set(oldApp.configuration.name, newName);
      }

      return { updatedApps, removedNames, renames };
    },
    [disposeMonacoModelsForApp, createMonacoModelsForApp],
  );

  // Apply configuration and sync all state
  const applyConfiguration = useCallback(
    (newConfiguration: Configuration) => {
      const previousVariables = configurationRef.current?.variables ?? {};
      setConfiguration(newConfiguration);

      setApps((prevApps) => {
        const { updatedApps, renames } = syncAppsFromConfiguration(newConfiguration, prevApps, previousVariables);

        // A draft isn't bound to an app — deleting one leaves the draft
        // alone, it just stops compiling. Only a rename needs following, so the
        // imports keep resolving.
        if (renames.size > 0) {
          viewsRef.current.forEach((view) => {
            if (view.type !== "draft") return;
            let value = view.model.getValue();
            for (const [oldName, newName] of renames) {
              value = remapEditorCode(value, oldName, newName);
            }
            if (value !== view.model.getValue()) {
              view.model.setValue(value);
              updateDraft(view.draftId, (draft) => ({ ...draft, code: value }));
            }
          });
        }

        return updatedApps;
      });
    },
    [syncAppsFromConfiguration, updateDraft],
  );

  // Toggling the Apps preview adds or removes the configured apps from the sidebar
  // immediately by re-reconciling the current configuration.
  useEffect(() => {
    if (configurationRef.current) {
      applyConfiguration(configurationRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewApps]);

  // Keep the variables scripts read via `kaja.variables` — and the editor's typed
  // declaration for them — in sync with the configuration, whichever path loaded
  // it (initial compile, save, or hot reload).
  useEffect(() => {
    const variables = configuration?.variables ?? {};
    setVariables(variables);
    registerKajaModule(Object.keys(variables));
    if (!hostRef.current) return;
    // Scripts read resolved values, including the ones kaja.json only names.
    // That is the desktop only: its UI runs inside the app's own process, so
    // there is no remote browser being handed a value it shouldn't have. On the
    // web the configuration's own text is all there is — and no scripts to read
    // it. They belong to the host rather than to a run, so a run in flight reads
    // the same values as one started afterwards.
    if (isWailsEnvironment()) {
      ResolvedVariables()
        .then((resolved) => {
          if (hostRef.current) hostRef.current.variables = resolved;
        })
        .catch((error) => console.error("Failed to read the resolved variables", error));
    } else {
      hostRef.current.variables = variables;
    }
  }, [configuration?.variables]);

  // Handle external configuration file changes (hot reload)
  const handleConfigurationFileChange = useCallback(async () => {
    const client = getApiClient();
    const { response } = await client.getConfiguration({});
    setVariableStatus(response.variableStatus);
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
  }, [applyConfiguration]);

  useConfigurationChanges(handleConfigurationFileChange);

  // Let the editor's value completions resolve the services the open apps expose.
  useEffect(() => {
    setValueCompletionApps(apps);
  }, [apps]);

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme(colorMode));
    document.body.style.backgroundColor = surfaceColor(colorMode);
    // Drive the shadcn theme tokens. The class goes on <html> so Radix portals
    // (rendered into <body>) are themed too.
    document.documentElement.classList.toggle("dark", colorMode === "night");
  }, [colorMode]);

  // A draft names itself from its own code, so the window follows the list
  // rather than the view: running or appending re-derives the title without the
  // view itself changing, and reading it through a ref would leave the window on
  // the name the row has already stopped showing.
  useEffect(() => {
    const current = views[0];
    let title = "Kaja";
    if (current?.type === "draft") {
      title = `${viewIdentity(current, drafts).name} - Kaja`;
    } else if (current?.type === "script") {
      title = `${current.script.name} - Kaja`;
    }
    document.title = title;
    if (isWailsEnvironment()) {
      WindowSetTitle(title);
    }
  }, [views, drafts]);

  // Load the global scripts directory. Scripts are independent of apps; they
  // bind to an app at run time via their import paths. The folder is read
  // wherever it is — off disk on the desktop, through the server in a browser,
  // which is what makes a workspace's own scripts visible in a container.
  const refreshScripts = useCallback(() => {
    listScriptFiles()
      .then((list) => setScripts(sortScripts(list)))
      .catch((err) => {
        console.error("Failed to list scripts", err);
        setScripts([]);
      });
    // A folder holding nothing has no file to be inferred from, so the folders
    // are listed of their own.
    listScriptFolders()
      .then((list) => setScriptFolders(list))
      .catch(() => setScriptFolders([]));
  }, []);

  useEffect(() => {
    refreshScripts();
  }, [refreshScripts]);

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarCollapsed((collapsed) => !collapsed);
        return;
      }
      // ⌘P opens the finder on the previous place, so ⌘P⏎ is "back".
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setFinder("previous");
        return;
      }
      // A blank script — the other half of "pick a call and Kaja writes one".
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        onNewDraftRef.current();
        return;
      }
      // The same key as the </> button in the command row, on every file that
      // has a JSON representation.
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggleJsonViewRef.current();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handler = () => {
      // Flush any pending debounced script auto-saves before the page goes away.
      for (const view of viewsRef.current) {
        if (view.type === "script" && scriptSaveTimers.current.has(view.id)) {
          clearTimeout(scriptSaveTimers.current.get(view.id)!);
          writeScriptFile(view.script, view.model.getValue()).catch(() => {});
        }
      }
      scriptSaveTimers.current.clear();
      persistViews();
      flushPersistedWrites();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persistViews]);

  const onCompilationUpdate = (updatedApps: AppModel[] | ((prev: AppModel[]) => AppModel[])) => {
    // Handle both direct array and functional updates
    if (typeof updatedApps === "function") {
      setApps((prevApps) => {
        const newApps = updatedApps(prevApps);
        handlePostCompilationLogic(newApps);
        return newApps;
      });
    } else {
      setApps(updatedApps);
      handlePostCompilationLogic(updatedApps);
    }
  };

  const handlePostCompilationLogic = (updatedApps: AppModel[]) => {
    // Register the Monaco source models that back script imports like
    // "app/service" for every app that has compiled, regardless of whether the
    // others are done. Gating this on all apps compiling meant a single slow or
    // failing app kept scripts from resolving apps that were ready. Idempotent:
    // create on first sight, update in place when the definitions change.
    let sourceModelsChanged = false;
    updatedApps.forEach((app) => {
      app.sources?.forEach((source) => {
        const uri = monaco.Uri.parse("ts:/" + source.path);
        const existingModel = monaco.editor.getModel(uri);
        if (!existingModel) {
          monaco.editor.createModel(source.file.text, "typescript", uri);
          sourceModelsChanged = true;
        } else if (existingModel.getValue() !== source.file.text) {
          existingModel.setValue(source.file.text);
          sourceModelsChanged = true;
        }
      });
    });

    // A source model appearing after a script view's own model was created does
    // not retroactively clear the stale "cannot find module" error on the
    // script; poke the open script editors so TypeScript re-resolves. (Task views
    // are opened only after their app has compiled, so they resolve on creation
    // and are additionally refreshed below when restored.)
    if (sourceModelsChanged) {
      refreshOpenScriptEditors();
    }

    // Check if all apps have finished compiling successfully
    const allCompiled = updatedApps.every((p) => p.compilation.status === "success");
    if (allCompiled && updatedApps.length > 0 && updatedApps[0].services.length > 0) {
      if (updatedApps.length === 0) {
        return;
      }

      // Restored drafts were created before the source models existed, so
      // poke their editors to revalidate now that the imports resolve.
      if (viewsRestoredRef.current) {
        viewsRestoredRef.current = false;
        refreshOpenDraftEditors();
        return;
      }

      // Only auto-open the first method on first-time use (no previous view memory)
      if (!hasViewMemory.current) {
        const defaultMethodAndService = getDefaultMethod(updatedApps[0].services);
        if (!defaultMethodAndService) {
          return;
        }
        onMethodSelect(defaultMethodAndService.method, defaultMethodAndService.service, updatedApps[0]);
      }
    }
  };

  const { configurationLoaded } = useCompilation(apps, onCompilationUpdate, (response) => {
    if (response.configuration) {
      setConfiguration(response.configuration);
    }
    setVariableStatus(response.variableStatus);
    if (response.runtime) {
      setRuntime(response.runtime);
    }
  });

  /**
   * Clicking a method never asks what to do with it. The current draft
   * decides: an untouched one is a browsing buffer and gets taken over, a
   * worked-in one is left alone and the call starts a new draft — unless an
   * untouched draft already holds exactly this call, which is reopened rather
   * than made a second time. Appending to what you already have is the
   * deliberate gesture (⌥click, or the + on the row), so it can't happen by
   * drifting.
   */
  const onMethodSelect = useCallback(
    async (method: Method, service: Service, app: AppModel, mode: "go" | "append" = "go") => {
      // Generated code arrives as one statement per line, which for a request of
      // twenty fields is one very long line. Wrap it before it goes anywhere, so
      // the text in the store, in the editor and on disk is the same readable
      // thing — the editor's own format-on-open can't help a buffer that is
      // written into a model it already has.
      const code = await formatTypeScript(generateMethodEditorCode(app, service, method));
      const originAppName = app.configuration.name;
      // What the sidebar tree opens with next time. Both the tree and the finder
      // arrive here, so this is the one place a call is chosen.
      recordUse(methodUse(originAppName, service, method));
      const now = Date.now();
      const current = viewsRef.current[0];
      const currentDraft = current?.type === "draft" ? draftsRef.current.find((s) => s.id === current.draftId) : undefined;

      if (mode === "append" && current?.type === "draft" && currentDraft) {
        const merged = await formatTypeScript(appendCall(current.model.getValue(), code));
        current.model.setValue(merged);
        updateDraft(currentDraft.id, (draft) => withCode(draft, merged, now));
        return;
      }

      // An untouched draft holding exactly this call is the buffer this click
      // would produce, so it is reopened instead. This is decided before the
      // takeover, which would otherwise be the thing that made the duplicate.
      const held = findUntouched(draftsRef.current, code, originAppName);
      if (held) {
        updateDraft(held.id, (draft) => reopen(draft, now));
        applyViews((views) => showDraft(views, held));
        return;
      }

      if (currentDraft && isUntouched(currentDraft)) {
        current.type === "draft" && current.model.setValue(code);
        updateDraft(currentDraft.id, (draft) => takeOver(draft, code, originAppName, now));
        return;
      }

      const draft = createDraft(code, originAppName, now);
      applyDrafts((list) => [draft, ...list]);
      applyViews((views) => showDraft(views, draft));
    },
    [applyDrafts, applyViews, updateDraft],
  );

  const onDraftSelect = useCallback(
    (draft: Draft) => {
      applyViews((views) => showDraft(views, draft));
    },
    [applyViews],
  );

  /**
   * Discarding a draft takes nothing off disk, so it is undone rather than
   * confirmed: the rows go, and a bar offers them back for a few seconds. It is
   * the same mechanism for one row and for a sweep of the whole pile, because
   * they cost the same — nothing.
   */
  const discardDrafts = useCallback(
    (list: Draft[], label: string) => {
      if (list.length === 0) return;
      const ids = new Set(list.map((draft) => draft.id));
      applyViews((views) => views.filter((view) => !(view.type === "draft" && ids.has(view.draftId))));
      applyDrafts((current) => current.filter((draft) => !ids.has(draft.id)));
      // The console goes with the draft, and is held alongside it so taking the
      // discard back brings the runs back too.
      const held = list.map((draft) => ({ draft, runs: consoles.takeFile(draft.id) }));
      for (const draft of list) dropStoredFile(draft.id);
      if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
      setDiscarded({ drafts: held, label });
      discardTimerRef.current = setTimeout(() => setDiscarded(null), UNDO_DISCARD_MS);
    },
    [applyDrafts, applyViews],
  );

  const onDiscardDraft = useCallback((draft: Draft) => discardDrafts([draft], `Discarded ${draft.title}`), [discardDrafts]);

  const onUndoDiscard = useCallback(() => {
    if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    setDiscarded((held) => {
      if (held) {
        applyDrafts((list) => [...held.drafts.map((entry) => entry.draft), ...list]);
        for (const { draft, runs } of held.drafts) {
          if (!runs) continue;
          consoles.putFile(draft.id, runs);
          saveRuns(draft.id, runs.runs, runs.allItems());
        }
      }
      return null;
    });
  }, [applyDrafts]);

  // A blank script, for when you know what you want to write and don't need a
  // call to start it. The empty state names the key, so it has to exist.
  const onNewDraft = useCallback(() => {
    const draft = createDraft("", undefined, Date.now());
    applyDrafts((list) => [draft, ...list]);
    applyViews((views) => showDraft(views, draft));
  }, [applyDrafts, applyViews]);
  const onNewDraftRef = useRef(onNewDraft);
  onNewDraftRef.current = onNewDraft;

  /**
   * The buffer an agent explores in. A snippet it sends has no file of its own,
   * so it is given the same one every time: eight tries at a call are eight runs
   * of one draft — which is what makes them comparable in the history — rather
   * than a trail of eight rows in the sidebar. It is an ordinary draft in every
   * other way, titled from its own code and free to be named or discarded; if it
   * goes, the next snippet starts another. Which one it is outlives the window,
   * or every restart would leave one more buffer behind that nothing reuses.
   *
   * What it has that an ordinary draft doesn't is attribution: the client's own
   * name, which pins the row above your drafts, outside the count and outside
   * the sweep, and labels it with an actor you recognise.
   */
  const agentDraftIdRef = useRef<string | undefined>(getPersistedValue<string>("agentDraftId") ?? getPersistedValue<string>("agentScratchId"));
  const agentDraft = useCallback(
    (code: string, client: string): Draft => {
      const now = Date.now();
      const held = draftsRef.current.find((draft) => draft.id === agentDraftIdRef.current);
      // A run is the punctuation that settles a draft, and one is about to
      // happen — so the title is re-read from the code now, as any run does.
      // The client comes with the run, so the row wears the name of whichever
      // agent touched it last.
      const draft = { ...markRun(held ?? createDraft(code, undefined, now), code, now), agentClient: client };
      agentDraftIdRef.current = draft.id;
      setPersistedValue("agentDraftId", draft.id);
      applyDrafts((list) => (held ? list.map((candidate) => (candidate.id === draft.id ? draft : candidate)) : [draft, ...list]));
      // If the buffer is on screen, it shows what is about to run in it.
      const view = viewsRef.current.find((candidate) => candidate.type === "draft" && candidate.draftId === draft.id);
      if (view?.type === "draft" && view.model.getValue() !== code) view.model.setValue(code);
      return draft;
    },
    [applyDrafts],
  );
  const agentDraftRef = useRef(agentDraft);
  agentDraftRef.current = agentDraft;

  /**
   * The agent saved its buffer as a file, so the buffer goes with it rather than
   * lingering as a copy — the same rule a person's Save follows, and the runs
   * follow the file the same way. Only an exact copy is the same document: a
   * script the agent wrote differently from what it ran is a new one, and the
   * buffer it explored in stays where it is.
   */
  const consumeAgentDraft = useCallback(
    (script: Script, content: string) => {
      const id = agentDraftIdRef.current;
      const draft = id ? draftsRef.current.find((candidate) => candidate.id === id) : undefined;
      if (!id || !draft || draft.code !== content) return;
      agentDraftIdRef.current = undefined;
      setPersistedValue("agentDraftId", undefined);
      const shown = viewsRef.current.find((view) => view.type === "draft" && view.draftId === id);
      applyViews((views) => (shown ? dropView(showScript(views, script, content), shown.id) : views));
      applyDrafts((list) => list.filter((candidate) => candidate.id !== id));
      consoles.renameFile(id, script.path);
      renameStoredFile(id, script.path);
      moveRunInput(id, script.path);
    },
    [applyDrafts, applyViews],
  );

  /**
   * Opening the agent's draft puts the editor in **follow mode**: the client is
   * rewriting the buffer between runs, so accepting keystrokes into it would be
   * pretending you can edit something that is about to be replaced.
   *
   * **Take over** is the one interaction — it copies the buffer into a draft of
   * your own and stops following. The agent keeps its row and carries on.
   */
  const agentViewClient = useCallback(
    (draftId: string) => draftsRef.current.find((draft) => draft.id === draftId && isAgentDraft(draft))?.agentClient,
    // The list is read through the ref, so this only has to re-run when it moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts],
  );

  const onTakeOverAgentDraft = useCallback(
    (draftId: string) => {
      const held = draftsRef.current.find((draft) => draft.id === draftId);
      if (!held) return;
      const now = Date.now();
      // A copy of the code, and nothing of the attribution: it is yours from
      // here, and it counts as work rather than as another browsing buffer.
      const mine = { ...createDraft(held.code, held.originAppName, now), title: held.title, generatedCode: "", ran: false };
      applyDrafts((list) => [mine, ...list]);
      applyViews((views) => showDraft(views, mine));
    },
    [applyDrafts, applyViews],
  );

  const onScriptSelect = useCallback(
    async (script: Script) => {
      try {
        const file = await readScriptFile(script);
        if (!file) return;
        applyViews((views) => showScript(views, file.script, file.content));
      } catch (err) {
        showFileError(`Open failed: ${err}`);
      }
    },
    [applyViews, showFileError],
  );

  // Right-click → the `kaja://run/<script>` link that runs this script, shown
  // before it is copied: nobody has seen one of these before, and the half of
  // it worth having is the query, which a silent copy can't carry. The
  // parameters are read out of the script's own source, so the sheet asks for
  // what this script actually takes — from the open buffer when it is open,
  // since that is the script as it is now rather than as disk caught up to it.
  const onCopyScriptLink = useCallback(
    async (script: Script) => {
      try {
        const open = viewsRef.current.find((view) => view.type === "script" && view.script.path === script.path);
        const content = open?.type === "script" ? open.model.getValue() : (await readScriptFile(script))?.content;
        setLinkSheet({ script, parameters: content ? readInputKeys(content) : [] });
      } catch (err) {
        showFileError(`Copy deeplink failed: ${err}`);
      }
    },
    [showFileError],
  );

  // A `kaja://run/…` link opens the script it names and asks. Anything that can
  // open a URL can arrive here — a launcher, a Shortcut, a web page — so the
  // link is never taken as permission by itself: it says which script and with
  // what, and pressing Run is what runs it.
  const openScriptLink = useCallback(
    (text: string) => {
      const parsed = parseScriptLink(text);
      if (!parsed.ok) {
        showFileError(parsed.error);
        return;
      }
      const script = (scriptsRef.current ?? []).find((candidate) => isLinkedScript(scriptName(candidate), parsed.link.script));
      if (!script) {
        showFileError(`No script named "${parsed.link.script}".`);
        return;
      }
      // Open it first, so the question is asked over the script it is about.
      void onScriptSelect(script);
      // And nothing may open over it. A first-time window with no view memory
      // opens the first method it finds once the apps have compiled, which
      // lands after this and takes the pane — on the web that is every new
      // browser, and arriving by URL is exactly when somebody has none. A link
      // naming a script is a stronger statement than the guess that rule makes.
      hasViewMemory.current = true;
      setLinkPrompt({ script, input: parsed.link.input });
    },
    [onScriptSelect, showFileError],
  );

  const openScriptLinkRef = useRef(openScriptLink);
  openScriptLinkRef.current = openScriptLink;

  // Run what the deeplink asked for, with what the sheet holds as `kaja.input`
  // — which is the deeplink's own query unless it was corrected before the run.
  const onConfirmScriptLink = useCallback(
    async (script: Script, input: { [key: string]: string }) => {
      try {
        const file = await readScriptFile(script);
        if (!file) return;
        rememberRunInput(file.script.path, input);
        // The deeplink's parameters are what this run was started with, not
        // something written onto a shared object — so a second one arriving
        // mid-run, or a Run pressed beside it, cannot take them or leave its
        // own behind.
        const { run, kaja } = beginRun(file.script.name, file.script.path, undefined, { input });
        setPresentRunId(run.id);
        runScript(file.content, kaja, apps, reportScriptError(run))
          .then(() => kaja.settleTables())
          .finally(() => markSettled(run.id));
      } catch (err) {
        showFileError(`Run failed: ${err}`);
      }
    },
    [apps, showFileError, reportScriptError, beginRun, markSettled],
  );

  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("link:open", (link: string) => openScriptLinkRef.current(link));
    return () => unsub();
  }, []);

  const linksReadyRef = useRef(false);

  // On the web there is nothing to deliver a link: the link *is* the page load,
  // or — Kaja already being open in a tab — a change of fragment, which the
  // browser makes without reloading anything. Both are the same door.
  //
  // The fragment is cleared once it has been handed over, because the URL is a
  // door rather than a location: this window shows whatever you last selected,
  // and an address bar still naming a script you have since navigated away from
  // is claiming something false. A `replaceState` fires no `hashchange`, so
  // clearing it can't come back around as a second arrival.
  //
  // The desktop holds a link that arrives before the UI is listening; the web
  // needs no buffer, because the URL is one — a fragment that arrives too
  // early is simply left where it is, and the readiness effect below reads it.
  const takeLinkFromLocation = useCallback(() => {
    if (!linksReadyRef.current || !hasScriptLink(window.location.href)) return;
    const href = window.location.href;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    openScriptLinkRef.current(href);
  }, []);

  useEffect(() => {
    if (isWailsEnvironment()) return;
    const onHashChange = () => takeLinkFromLocation();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [takeLinkFromLocation]);

  // A link that launched the app arrived long before any of this existed, and
  // the desktop holds those until we say we are here — which is once the script
  // list is in, since before that there is nothing for a link to name. The web
  // reaches the same moment by reading its own URL.
  useEffect(() => {
    if (linksReadyRef.current || scripts === undefined) return;
    linksReadyRef.current = true;
    if (isWailsEnvironment()) EventsEmit("link:ready");
    else takeLinkFromLocation();
  }, [scripts, takeLinkFromLocation]);

  /**
   * A file auto-saves as you edit it (debounced), which is the other half of
   * rule 2: editing a file leaves it a file, in place. There is exactly one way
   * into Drafts — running something that has no file yet — so no edit to a file
   * ever forks one off, and there is no unsaved state for one to be in either.
   */
  useEffect(() => {
    if (!canWriteScripts()) return;
    const disposables: monaco.IDisposable[] = [];
    for (const view of views) {
      if (view.type !== "script") continue;
      const { id, model, script } = view;
      disposables.push(
        model.onDidChangeContent(() => {
          if (suppressScriptSave.current.has(id)) return;
          const existing = scriptSaveTimers.current.get(id);
          if (existing) clearTimeout(existing);
          scriptSaveTimers.current.set(
            id,
            setTimeout(() => {
              scriptSaveTimers.current.delete(id);
              writeScriptFile(script, model.getValue()).catch((err) => showFileError(`Save failed: ${err}`));
            }, 500),
          );
        }),
      );
    }
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [views, showFileError]);

  // Script views are file-backed, so disk is their source of truth. The persisted
  // view-state cache can go stale while the app is closed — an MCP write_script, an
  // external editor, or another window can change the file — so on mount re-read
  // each restored script view from disk and reconcile its model. Without this a
  // reload would show the cached copy captured before the file last changed. The
  // beforeunload handler flushes pending saves, so disk is never behind the cache.
  // A browser reads through the server rather than off disk, and it is the case
  // that goes stale hardest: nothing there can write the file, so every change to
  // one arrived from somewhere this session never saw.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let reconciled = false;
      for (const view of viewsRef.current) {
        if (view.type !== "script") continue;
        try {
          const file = await readScriptFile(view.script);
          if (cancelled || !file || view.model.getValue() === file.content) continue;
          // Suppress the auto-save this edit would trigger — the content is disk's.
          suppressScriptSave.current.add(view.id);
          view.model.pushEditOperations([], [{ range: view.model.getFullModelRange(), text: file.content }], () => null);
          suppressScriptSave.current.delete(view.id);
          reconciled = true;
        } catch {
          // File missing or unreadable (e.g. deleted while closed); keep the
          // restored buffer rather than dropping the user's view.
        }
      }
      if (!cancelled && reconciled) persistViews();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The naming sheet asks for a name and a folder, and nothing else. The folder
   * defaults to the last one used, so filing several drafts in a row is
   * Enter-Enter.
   */
  const lastFolderRef = useRef<string>(getPersistedValue<string>("lastScriptFolder") ?? "");
  const openNameSheet = useCallback((sheet: NameSheet) => {
    setNameSheetError(undefined);
    setNameSheet(sheet);
  }, []);

  // The names already spoken for in a folder, so a proposed one doesn't collide
  // with a file that is already there.
  const takenNames = useCallback((folder: string) => (scriptsRef.current ?? []).filter((script) => script.folder === folder).map((script) => script.name), []);

  /**
   * ⌘S names a draft, which is what makes it a file. A file has nothing to ask
   * about and nothing to write — it is already on disk, and stays there as you
   * type — so the key does nothing on one.
   */
  const onRequestSave = useCallback(() => {
    if (!canWriteScripts()) return;
    const view = viewsRef.current[0];
    if (view?.type !== "draft") return;
    const draft = draftsRef.current.find((candidate) => candidate.id === view.draftId);
    openNameSheet({
      verb: "name",
      name: proposeFileName(viewIdentity(view, draftsRef.current).name, takenNames("")),
      folder: lastFolderRef.current,
      content: view.model.getValue(),
      draftId: view.draftId,
      title: draft && isAgentDraft(draft) ? `Name what ${draft.agentClient} wrote` : "Name this draft",
    });
  }, [openNameSheet, takenNames]);

  const onNameDraft = useCallback(
    (draft: Draft) =>
      openNameSheet({
        verb: "name",
        name: proposeFileName(draft.title, takenNames("")),
        folder: lastFolderRef.current,
        content: draft.code,
        draftId: draft.id,
        title: isAgentDraft(draft) ? `Name what ${draft.agentClient} wrote` : "Name this draft",
      }),
    [openNameSheet, takenNames],
  );

  /**
   * Clearing the pile. Untouched drafts are still byte-identical to the code
   * that was generated for them, so clearing those removes nothing you wrote and
   * needs no confirm — clicking the method again writes the same thing back.
   * Clearing everything asks first, but only when it costs something, and then
   * names the work at stake.
   */
  const onClearUntouched = useCallback(() => {
    const list = untouchedDrafts(draftsRef.current);
    if (list.length > 0) discardDrafts(list, `${list.length} untouched ${list.length === 1 ? "draft" : "drafts"} cleared`);
  }, [discardDrafts]);

  const onClearAllDrafts = useCallback(() => {
    const all = draftsRef.current.filter((draft) => !isAgentDraft(draft));
    if (all.length === 0) return;
    const edited = editedDrafts(all);
    if (edited.length === 0) {
      discardDrafts(all, `${all.length} ${all.length === 1 ? "draft" : "drafts"} cleared`);
      return;
    }
    setClearAllPrompt({ all, edited });
  }, [discardDrafts]);

  const onRequestSaveRef = useRef(onRequestSave);
  onRequestSaveRef.current = onRequestSave;

  // Wire the native File → Save menu item (⌘S).
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("menu:saveScript", () => onRequestSaveRef.current());
    return () => unsub();
  }, []);

  // The MCP server is started by the desktop process itself, so all there is to
  // do here is read the connection details the footer shows.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    MCPServerInfo()
      .then((info) => setMcpInfo(info))
      .catch((err) => showFileError(`MCP server: ${err}`));
  }, [showFileError]);

  // The catalog follows the apps, not the compiler. Pushing it from the
  // compilation path meant a change that compiles nothing — deleting an app,
  // and above all deleting the last one — left the server answering from the
  // apps that were there before. The variables ride along for the same reason
  // the editor's declaration takes them: they are part of what a script is
  // written against.
  useEffect(() => {
    const variableNames = Object.keys(configuration?.variables ?? {});
    const catalog = JSON.stringify(buildMcpCatalog(apps, variableNames));
    if (isWailsEnvironment()) {
      MCPSetCatalog(catalog).catch(() => {});
    } else {
      // The server keeps the last catalog a window pushed for as long as the
      // session lives, which is what lets discovery answer across a reload —
      // only run_script actually needs a window that is open right now.
      agentSession.setCatalog(catalog);
    }
  }, [apps, configuration?.variables]);

  // An agent's calls come in bursts of a few milliseconds each, so the footer's
  // plug stays lit for as long as anything is in flight and a beat longer after
  // the last one — a mark that came and went inside one frame would say nothing.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    let timer: number | undefined;
    const unsub = EventsOn("mcp:activity", (payload: { inFlight: number }) => {
      window.clearTimeout(timer);
      setMcpActive(true);
      if (payload.inFlight <= 0) {
        timer = window.setTimeout(() => setMcpActive(false), MCP_ACTIVITY_LINGER_MS);
      }
    });
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  // Run a script on behalf of the MCP server's run_script tool and report the
  // console output, what it drew, and the RPCs it made. It is one function for
  // both builds: the desktop process hands it a run over a Wails event, a
  // deployed one over the session's stream, and a run is the same event either
  // way — its own console, its own row in the sidebar, the agent's own name.
  const runForAgent = useCallback(async ({ path, code, client }: { path: string; code: string; client?: string }): Promise<McpRunReport> => {
    let source = code;
    // The desktop asks the window to read the file, because the window is in the
    // process that holds the disk. A server reads it itself and sends the source
    // down with the path, so there is nothing left to read here.
    if (path && !source) {
      try {
        // The path is the script's identity, so the listing is what says which
        // folder it is filed in — the read takes a name within the folder.
        const known = (scriptsRef.current ?? []).find((script) => script.path === path);
        const file = known && (await readScriptFile(known));
        source = file ? file.content : "";
        if (!file) throw new Error(`No script at ${path}`);
      } catch (err) {
        return { console: [], error: err instanceof Error ? err.message : String(err), methodCalls: [] };
      }
    }

    // A saved script runs in its own console under its own name. A snippet has
    // no file, so it is given one: exploration in Kaja is a draft, and an
    // agent exploring is not a different kind of event from a person doing it.
    const draft = path ? undefined : agentDraftRef.current(source, client || "Agent");
    const fileId = path || draft?.id;
    // This run's own receipt. Two agents calling run_script at once each get
    // what their own script did, because the collector reaches the run through
    // its closures rather than through a slot the later one would take.
    const collect: RunCollector = { calls: [], blocks: new Map<string, Block>() };
    const report = () => ({ methodCalls: collect.calls.map(toMethodCallLog), blocks: [...collect.blocks.values()].map(toBlockLog) });
    let result: McpRunReport;
    const { run, kaja } = beginRunRef.current(path ? path.split("/").pop()! : (draft?.title ?? "Agent script"), fileId, undefined, {
      origin: "agent",
      collect,
    });
    try {
      const captured = await runScriptCaptured(source, kaja, appsRef.current);
      // An agent's table has nobody to page it, so its receipt is the first
      // page — which is exactly what it says it is.
      await kaja.settleTables();
      result = { ...captured, ...report() };
    } catch (err) {
      result = { console: [], error: err instanceof Error ? err.message : String(err), ...report() };
    } finally {
      markSettledRef.current(run.id);
    }
    return result;
  }, []);
  const runForAgentRef = useRef(runForAgent);
  runForAgentRef.current = runForAgent;

  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("mcp:runScript", async (payload: { id: string; path: string; code: string; client?: string }) => {
      const result = await runForAgentRef.current(payload);
      MCPScriptResult(payload.id, JSON.stringify(result)).catch(() => {});
    });
    return () => unsub();
  }, []);

  // The web's half of the same thing. There is no window to reach on a server,
  // so this one offers itself: a token this browser made up, a stream held open
  // under it, and the runs that come down it. Nothing is offered until the
  // footer's Connect is pressed, so a casual visitor holds no session at all.
  useEffect(() => {
    if (isWailsEnvironment()) return;
    let timer: number | undefined;
    agentSession.start(
      (run) => runForAgentRef.current(run),
      (active) => {
        window.clearTimeout(timer);
        setMcpActive(active);
      },
    );
    return () => window.clearTimeout(timer);
  }, []);

  // Reflect a rename or a move that already happened on disk: update the sidebar
  // list, re-point any open view.
  const applyScriptRename = useCallback(
    (oldPath: string, renamed: Script) => {
      setScripts((prev) => sortScripts((prev ?? []).map((script) => (script.path === oldPath ? renamed : script))));
      applyViews((views) => views.map((view) => (view.type === "script" && view.script.path === oldPath ? { ...view, script: renamed } : view)));
      // The file is the console's key, so a rename moves it rather than losing it.
      consoles.renameFile(oldPath, renamed.path);
      renameStoredFile(oldPath, renamed.path);
      moveRunInput(oldPath, renamed.path);
    },
    [applyViews],
  );

  /**
   * Writing what the naming sheet holds. One handler for all three verbs,
   * because on disk they are one write: a name and a folder become a path, and a
   * file's path is its name.
   */
  const onConfirmNameSheet = useCallback(async () => {
    const sheet = nameSheet;
    if (!sheet) return;
    const name = sheet.name.trim();
    if (!name) {
      setNameSheetError("Enter a name.");
      return;
    }
    const folder = sheet.folder.trim().replace(/^\/+|\/+$/g, "");

    try {
      if (sheet.verb === "name") {
        const script = await createScriptFile(name, folder, sheet.content ?? "");
        const content = sheet.content ?? "";
        setScripts((prev) => sortScripts([...(prev ?? []), script]));
        if (folder) setScriptFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder].sort()));
        applyViews((views) => {
          const shown = showScript(views, script, content);
          // The draft became the file, so it doesn't linger as a copy.
          const source = sheet.draftId && shown.find((view) => view.type === "draft" && view.draftId === sheet.draftId);
          return source ? dropView(shown, source.id) : shown;
        });
        if (sheet.draftId) {
          const id = sheet.draftId;
          applyDrafts((list) => list.filter((candidate) => candidate.id !== id));
          if (id === agentDraftIdRef.current) {
            agentDraftIdRef.current = undefined;
            setPersistedValue("agentDraftId", undefined);
          }
          // Naming changes what the file is called, not what it is, so its runs
          // come along to the path it now lives at.
          consoles.renameFile(id, script.path);
          renameStoredFile(id, script.path);
          moveRunInput(id, script.path);
        }
      } else if (sheet.script) {
        // Flush the pending auto-save to the current path, so the rename moves
        // what is in the buffer rather than what disk caught up to.
        const open = viewsRef.current.find((view) => view.type === "script" && view.script.path === sheet.script!.path);
        if (open) flushScriptWrite(open);
        const renamed = await renameScriptFile(sheet.script, name, folder);
        applyScriptRename(sheet.script.path, renamed);
        if (folder) setScriptFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder].sort()));
      }
      // The last folder used is the default next time, so repeat filing is
      // Enter-Enter.
      lastFolderRef.current = folder;
      setPersistedValue("lastScriptFolder", folder);
      setNameSheet(null);
      setNameSheetError(undefined);
    } catch (err) {
      setNameSheetError(String(err));
    }
  }, [nameSheet, applyDrafts, applyViews, applyScriptRename, flushScriptWrite]);

  const onRenameScript = useCallback(
    (script: Script) => openNameSheet({ verb: "rename", name: script.name.replace(/\.ts$/, ""), folder: script.folder, script, title: "Rename file" }),
    [openNameSheet],
  );

  const onMoveScript = useCallback(
    (script: Script) => openNameSheet({ verb: "move", name: script.name.replace(/\.ts$/, ""), folder: script.folder, script, title: "Move file" }),
    [openNameSheet],
  );

  // Reflect a deletion that already happened on disk: drop the script from the
  // sidebar list, and close its view.
  const removeScriptFromUI = useCallback(
    (path: string) => {
      setScripts((prev) => (prev ?? []).filter((s) => s.path !== path));
      // The file is gone, so its console goes with it.
      consoles.dropFile(path);
      dropStoredFile(path);
      applyViews((views) => {
        const shown = views.find((candidate) => candidate.type === "script" && candidate.script.path === path);
        if (!shown) return views;
        // Cancel the pending auto-save so dropping the view can't recreate the
        // file that was just deleted.
        const timer = scriptSaveTimers.current.get(shown.id);
        if (timer) {
          clearTimeout(timer);
          scriptSaveTimers.current.delete(shown.id);
        }
        return dropView(views, shown.id);
      });
    },
    [applyViews],
  );

  // Right-click → Delete file: the only destructive action in the sidebar that
  // touches disk, which is why it is the only one that asks first.
  const onConfirmDeleteScript = useCallback(
    async (script: Script) => {
      try {
        await deleteScriptFile(script);
      } catch (err) {
        showFileError(`Delete failed: ${err}`);
        return;
      }
      removeScriptFromUI(script.path);
    },
    [showFileError, removeScriptFromUI],
  );

  /**
   * Folders. Creating one, renaming it and removing it all hit disk immediately
   * — a folder in Files is a directory under the workspace's scripts root, not a
   * grouping the sidebar invented — so there is no staged state to reconcile,
   * and an import has a stable path to reference.
   */
  const onCreateFolder = useCallback(
    async (path: string) => {
      try {
        const created = await createScriptFolder(path);
        setScriptFolders((prev) => (prev.includes(created) ? prev : [...prev, created].sort()));
      } catch (err) {
        showFileError(`New folder failed: ${err}`);
      }
    },
    [showFileError],
  );

  const onRenameFolder = useCallback(
    async (path: string, name: string) => {
      try {
        const moved = await renameScriptFolder(path, name);
        setScriptFolders((prev) =>
          prev.map((folder) => (folder === path ? moved : folder.startsWith(path + "/") ? moved + folder.slice(path.length) : folder)).sort(),
        );
        // Everything filed in it moved with it, and a file's path is its name.
        const within = (folder: string) => folder === path || folder.startsWith(path + "/");
        for (const script of scriptsRef.current ?? []) {
          if (!within(script.folder)) continue;
          const folder = moved + script.folder.slice(path.length);
          applyScriptRename(script.path, {
            ...script,
            folder,
            path: script.path.slice(0, script.path.length - scriptName(script).length) + `${folder}/${script.name}`,
          });
        }
      } catch (err) {
        showFileError(`Rename failed: ${err}`);
      }
    },
    [applyScriptRename, showFileError],
  );

  const onConfirmDeleteFolder = useCallback(
    async (path: string) => {
      try {
        await deleteScriptFolder(path);
        setScriptFolders((prev) => prev.filter((folder) => folder !== path));
      } catch (err) {
        showFileError(`Delete failed: ${err}`);
      }
    },
    [showFileError],
  );

  const onRevealScripts = useCallback(() => {
    ScriptsFolder()
      .then((folder) => ShowFileInFinder(folder))
      .catch(() => {});
  }, []);

  // Reflect script changes made through the MCP server: live-reload the content
  // of an open view on write, and keep the sidebar list in step with
  // create/rename/delete — no manual refresh or view switch needed.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn(
      "mcp:scriptsChanged",
      (payload: { action: string; path: string; name?: string; folder?: string; content?: string; oldPath?: string }) => {
        switch (payload.action) {
          case "write": {
            const view = viewsRef.current.find((t) => t.type === "script" && t.script.path === payload.path);
            const content = payload.content ?? "";
            if (view?.type === "script" && view.model.getValue() !== content) {
              // The content just came from disk. Apply it as an edit (not setValue)
              // so undo history survives, and record it as what is saved — an
              // agent's write is a save, so the file is not modified afterwards.
              suppressScriptSave.current.add(view.id);
              view.model.pushEditOperations([], [{ range: view.model.getFullModelRange(), text: content }], () => null);
              suppressScriptSave.current.delete(view.id);
              // Keep the persisted view-state cache in step so a reload restores this
              // content, not the stale copy captured before the write.
              persistViews();
            }
            break;
          }
          case "create": {
            const script: Script = { path: payload.path, name: payload.name ?? "", folder: payload.folder ?? "" };
            setScripts((prev) => (prev && !prev.some((s) => s.path === script.path) ? sortScripts([...prev, script]) : prev));
            if (script.folder) setScriptFolders((prev) => (prev.includes(script.folder) ? prev : [...prev, script.folder].sort()));
            consumeAgentDraft(script, payload.content ?? "");
            break;
          }
          case "rename":
            if (payload.oldPath) {
              applyScriptRename(payload.oldPath, { path: payload.path, name: payload.name ?? "", folder: payload.folder ?? "" });
            }
            break;
          case "delete":
            removeScriptFromUI(payload.path);
            break;
        }
      },
    );
    return () => unsub();
  }, [applyScriptRename, applyViews, removeScriptFromUI, persistViews, consumeAgentDraft]);

  const onGoToDefinition = (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number) => {
    applyViews((views) => showDefinition(views, model, startLineNumber, startColumn));
  };

  const sidebarCollapseThreshold = 60;

  const onSidebarResize = (delta: number) => {
    if (sidebarCollapsedRef.current) {
      if (delta > 0) {
        setSidebarCollapsed(false);
        sidebarCollapsedRef.current = false;
        setSidebarWidth(sidebarMinWidth);
      }
      return;
    }
    setSidebarWidth((width) => {
      const newWidth = width + delta;
      if (newWidth < sidebarCollapseThreshold) {
        setSidebarCollapsed(true);
        sidebarCollapsedRef.current = true;
        return width;
      }
      return newWidth;
    });
  };

  const onGoToView = useCallback((id: string) => applyViews((views) => visit(views, id)), [applyViews]);

  // Track how tall each open editor's code is so the pane can be sized to it.
  // Derived from the line count rather than Monaco's content height: with
  // scrollBeyondLastLine on, content height grows with the editor itself, so
  // feeding it back into the pane height would only ever settle at the maximum.
  // The listeners belong to the editor and go away when the editor is disposed.
  const onEditorReady = useCallback(
    (viewId: string, editorInstance: monaco.editor.IStandaloneCodeEditor) => {
      editorRegistryRef.current.set(viewId, editorInstance);
      const report = () => {
        const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight);
        const height = (editorInstance.getModel()?.getLineCount() ?? 1) * lineHeight + EDITOR_PADDING;
        setEditorContentHeights((heights) => (heights[viewId] === height ? heights : { ...heights, [viewId]: height }));
      };
      report();
      editorInstance.onDidChangeModelContent(() => {
        report();
        // Only a real edit writes back: the editor formats its model on open,
        // and that isn't the user typing.
        if (!editorInstance.hasTextFocus()) return;

        const view = viewsRef.current.find((candidate) => candidate.id === viewId);
        if (view?.type !== "draft") return;
        // A draft has no save step, so its text is written back as it is
        // typed — debounced, because every keystroke would be a store write.
        const pending = draftSaveTimers.current.get(view.draftId);
        if (pending) clearTimeout(pending);
        draftSaveTimers.current.set(
          view.draftId,
          setTimeout(() => {
            draftSaveTimers.current.delete(view.draftId);
            updateDraft(view.draftId, (draft) => ({ ...draft, code: view.model.getValue(), updatedAt: Date.now() }));
          }, 400),
        );
      });
      editorInstance.onDidChangeModel(report);
    },
    [applyViews, updateDraft],
  );

  // The </> button in the command row edits the current file as JSON: same
  // position, same icon, same ⌘J, on every file that has a JSON representation,
  // and absent on the ones that don't. It shares the row's action slot with Run
  // — a file is never both a script and a form.
  const currentView = views[0];
  const jsonView =
    currentView?.type === "appForm"
      ? { showing: currentView.editMode === "json", back: "Edit as a form (⌘J)" }
      : currentView?.type === "variables"
        ? { showing: currentView.editMode === "json", back: "Edit as a table (⌘J)" }
        : undefined;

  const toggleJsonView = useCallback((): void => {
    const view = viewsRef.current[0];
    if (view?.type !== "appForm" && view?.type !== "variables") return;
    if (view.editMode === "json" && !viewJsonValidRef.current) return;
    applyViews((views) =>
      view.type === "appForm"
        ? setAppFormEditMode(views, view.id, view.editMode === "json" ? "form" : "json")
        : setVariablesEditMode(views, view.id, view.editMode === "json" ? "table" : "json"),
    );
  }, [applyViews]);
  const toggleJsonViewRef = useRef(toggleJsonView);
  toggleJsonViewRef.current = toggleJsonView;
  // The file on screen is the one Run runs, so its errors are the ones the row
  // reports — on the trigger, and as Run's reason for being disabled.
  const syntaxErrors = useSyntaxErrors(currentView?.type === "draft" || currentView?.type === "script" ? currentView.model : undefined);
  // The parameters the file on screen reads. A script that reads none has
  // nothing to be asked for, so Run stays a bare button.
  const inputKeys = useInputKeys(currentView?.type === "draft" || currentView?.type === "script" ? currentView.model : undefined);

  // Run the current file's editor contents. Triggered by Run in the command
  // row, by ⌘⏎ and by F5, and by the parameter sheet the caret beside Run
  // opens — which is the only way a manual run carries `kaja.input`.
  const onRunCurrentTab = useCallback(
    (input?: { [key: string]: string }) => {
      const view = viewsRef.current[0];
      if (!view || (view.type !== "draft" && view.type !== "script")) {
        return;
      }
      const editor = editorRegistryRef.current.get(view.id);
      if (!editor) {
        return;
      }
      const code = editor.getValue();
      const controller = new AbortController();
      // Run names reuse the derived script names, so the console and the sidebar
      // speak the same language.
      const title = view.type === "script" ? view.script.name : (deriveDraftTitle(code) ?? viewIdentity(view, draftsRef.current).name);
      const fileId = view.type === "script" ? view.script.path : view.draftId;
      // Whatever a run is started with is this run's, born with its Kaja rather
      // than written onto a shared object — so a plain Run beside it carries
      // nothing, and neither takes the other's parameters.
      if (input) rememberRunInput(fileId, input);
      const { run, kaja } = beginRun(title, fileId, controller, input ? { input } : undefined);
      // A live table draws its first page itself, and those calls are the run's:
      // the script is not over until they have landed, or the run would report a
      // duration that stops before the work it started.
      runScript(code, kaja, apps, reportScriptError(run), controller.signal)
        .then(() => kaja.settleTables())
        .finally(() => markSettled(run.id));
      // A run is the punctuation that settles a draft: it is when the title is
      // re-read from the code, rather than jittering as you type.
      if (view.type === "draft") {
        updateDraft(view.draftId, (draft) => markRun(draft, code, Date.now()));
      }
    },
    [apps, beginRun, reportScriptError, updateDraft, markSettled],
  );

  /**
   * A run is over. Its wall duration is known, what it produced is worth keeping
   * for the next time the file is opened, and it leaves the list of live ones —
   * which is what releases its `Kaja`, its approvals, its sampled methods and
   * its bound clients with it. A live table it drew holds that past this point,
   * and nothing else can.
   *
   * Settling and dropping the record are one act, because they were two: a run
   * taken off the list without a duration is one nothing can ever settle — the
   * list is where the settle check looks — and a run without a duration is a
   * running run to everything that reports one. So this is the only way out of
   * the list, and there is no shape of it that leaves a spinner turning.
   */
  const endRuns = useCallback((over: LiveRun[], now: number) => {
    if (over.length === 0) return;
    for (const { run } of over) {
      if (!run.fileId) continue;
      if (!consoles.settleRun(run.fileId, run.id, now - run.startedAt, now)) continue;
      const settled = consoles.file(run.fileId);
      saveRuns(run.fileId, settled.runs, settled.allItems(), now);
    }
    const ids = new Set(over.map((live) => live.run.id));
    setActiveRuns((runs) => runs.filter((live) => !ids.has(live.run.id)));
  }, []);

  /**
   * A generated method-call script issues its call without awaiting it, so the
   * script's own promise settles well before the response lands. The run is over
   * once the script has settled and nothing it started is still in flight — a
   * call, or a question it is parked on — and that is when its wall duration is
   * known and it is worth keeping for the next time the file is opened.
   *
   * It hangs off the store rather than off a render, because the alternative is
   * asking the question again for every call a run makes.
   */
  const settleIfQuiet = useCallback(() => {
    // Every run in flight is asked, because they finish in whatever order their
    // work does — the second one pressed is routinely the first one over.
    const done = activeRunsRef.current.filter((live) => live.settled && !consoles.hasWorkInFlight(live.run.fileId, live.run.id));
    endRuns(done, Date.now());
  }, [endRuns]);

  useEffect(() => consoles.subscribeQuiet(settleIfQuiet), [settleIfQuiet]);
  // The script returning is the other half: a run whose calls all landed while
  // it was still going has nothing left to report it.
  useEffect(settleIfQuiet, [activeRuns, settleIfQuiet]);

  // Which file the console is reporting on. Everything below the editor is that
  // file's: its runs, where it was left pointing, and what it was showing.
  const currentFileId = currentView?.type === "script" ? currentView.script.path : currentView?.type === "draft" ? currentView.draftId : undefined;

  // Reopening a script gives you its code and, if we still hold them, the runs
  // it last made. They are read once and sit underneath anything run since.
  useEffect(() => {
    if (!currentFileId || consoles.file(currentFileId).loaded) return;
    consoles.adoptStoredRuns(currentFileId, loadRuns(currentFileId), Date.now());
  }, [currentFileId]);

  /**
   * Stop aborts the calls the run has in flight; the script itself stops at the
   * call it was awaiting. A run parked on a question — or on a call waiting to
   * be approved — is awaiting the user rather than a call, so Stop has to end
   * that too or the script never returns.
   *
   * It reaches the runs of the file the button is on and no others. Cancelling
   * every question on screen was how one Stop used to end a script nobody had
   * pointed at.
   *
   * **Stop ends the run, rather than asking the script to end it.** Waiting for
   * the script to unwind is waiting on the thing that was stopped: a run parked
   * on a question that will never be asked again has nothing left to settle it,
   * and one sleeping between two calls settles whenever it feels like it. So the
   * run is ended here, which is what stops the spinner in the pill, the mark in
   * the tail bar and the sidebar's own — a stopped run used to turn all three
   * until the window was reloaded.
   */
  const onStopActiveRun = useCallback(() => {
    const stopping = activeRunsRef.current.filter((live) => live.run.fileId === currentFileId);
    if (stopping.length === 0) return;
    const ids = new Set(stopping.map((live) => live.run.id));
    for (const [blockId, pending] of [...pendingPromptsRef.current.entries()]) {
      if (ids.has(pending.runId)) onCancelAsk(blockId);
    }
    for (const live of stopping) live.controller?.abort();
    endRuns(stopping, Date.now());
  }, [onCancelAsk, currentFileId, endRuns]);

  /**
   * Run, asking first. The same sheet the deeplink doors use, minus the URL —
   * which is what closes the gap a script written for a deeplink used to fall
   * into: it could be launched with parameters and only half run in the app.
   */
  const onRunWithParameters = useCallback(() => {
    const view = viewsRef.current[0];
    if (!view || (view.type !== "draft" && view.type !== "script")) return;
    if (inputKeys.length === 0) return;
    setRunPrompt({
      fileId: view.type === "script" ? view.script.path : view.draftId,
      fileName: view.type === "script" ? view.script.name : viewIdentity(view, draftsRef.current).name,
      parameters: inputKeys,
    });
  }, [inputKeys]);
  const onRunWithParametersRef = useRef(onRunWithParameters);
  onRunWithParametersRef.current = onRunWithParameters;

  // The same sheet the sidebar's Copy deeplink opens, on the file already on
  // screen — so its parameters are read from the buffer rather than from disk.
  // A draft has no address; a file has one on either platform, since the web's
  // is this page's own URL.
  const onCopyCurrentLink = useMemo(() => {
    if (currentView?.type !== "script") return undefined;
    const script = currentView.script;
    return () => setLinkSheet({ script, parameters: inputKeys });
  }, [currentView, inputKeys]);
  const onCopyCurrentLinkRef = useRef(onCopyCurrentLink);
  onCopyCurrentLinkRef.current = onCopyCurrentLink;

  // The file itself rather than the folder it sits in, which is what the Files
  // group's own Reveal already does. `ShowFileInFinder` selects the file and
  // falls back to the nearest folder that exists, so a script written but not
  // yet flushed still lands somewhere useful.
  const onRevealCurrentScript = useMemo(() => {
    if (!isWailsEnvironment() || currentView?.type !== "script") return undefined;
    const script = currentView.script;
    return () => {
      ScriptsFolder()
        .then((folder) => ShowFileInFinder(`${folder}/${scriptName(script)}`))
        .catch(() => {});
    };
  }, [currentView]);

  /**
   * The copy of a read-only file, in the one place it can be edited. A file
   * never becomes a draft on its own — that is what keeps Drafts the group for
   * things that have never had a name — but a server serving a workspace it
   * does not own has no second file to copy this one into, so a draft is the
   * whole of what "take a copy of this and change it" can mean there. On the
   * desktop a file is writable and forking is deliberately not a gesture, so
   * this is absent.
   *
   * The buffer rather than the disk, on the same rule Run follows: the script
   * as it is now is the one being copied.
   */
  const onDuplicateAsDraft = useCallback(() => {
    const view = viewsRef.current[0];
    if (view?.type !== "script") return;
    const code = editorRegistryRef.current.get(view.id)?.getValue() ?? "";
    const now = Date.now();
    // A copy is work, not a browsing buffer: an empty `generatedCode` is what
    // keeps the next method click from taking it over and the sweep from
    // dropping it.
    const draft = { ...createDraft(code, undefined, now), generatedCode: "" };
    applyDrafts((list) => [draft, ...list]);
    applyViews((views) => showDraft(views, draft));
  }, [applyDrafts, applyViews]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A sheet on top of the editor answers ⏎ itself, and its Run is the one
      // that was asked for — so the file's own Run stays out of it.
      if (event.defaultPrevented) return;
      if (event.key === "F5" || ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === "Enter")) {
        event.preventDefault();
        onRunCurrentTab();
        return;
      }
      // The second gesture: Run, asking for the script's parameters first.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        onRunWithParametersRef.current();
        return;
      }
      // The script's address outside Kaja, on the gesture Raycast uses for the
      // same thing.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "c" || event.key === "C")) {
        const copy = onCopyCurrentLinkRef.current;
        // Only when there is a file to have an address; otherwise this is the
        // browser's own Copy and stays it.
        if (!copy) return;
        event.preventDefault();
        copy();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRunCurrentTab]);

  // With no apps there is nothing to have compiled, so the log stops existing
  // rather than sitting there naming the no-apps blankslate. It is never
  // restored into one, so deleting the last app is the only way in.
  useEffect(() => {
    if (!configurationLoaded || apps.length > 0) return;
    applyViews((views) => {
      const compiler = views.find((view) => view.type === "compiler");
      return compiler ? dropView(views, compiler.id) : views;
    });
  }, [apps.length, configurationLoaded, applyViews]);

  // Opens the compile log, expanded on an app when one is named. Nothing else
  // opens it: compiling is reported in the status bar, and the log is where you
  // go when it has something to say.
  const onShowCompileLog = useCallback(
    (appName?: string) => {
      setCompileLogExpandApp(appName ? { name: appName } : undefined);
      applyViews(showCompiler);
    },
    [applyViews],
  );

  // Recompiles one app, or every app when no name is given, by putting it back
  // to pending — the compilation hook picks it up from there. An app already
  // compiling is left to finish.
  const onRecompile = (appName?: string) => {
    setApps((prevApps) =>
      prevApps.map((app) => {
        if (appName !== undefined && app.configuration.name !== appName) return app;
        if (app.compilation.status === "running" || app.compilation.status === "pending") return app;
        return { ...app, compilation: { status: "pending" as const, logs: [] } };
      }),
    );
  };

  const onNewAppClick = () => {
    if (!runtime.canUpdateConfiguration) return;
    setNewAppOpen(true);
  };

  // Picking a type in the New dialog opens the create form view for that type. The
  // type is fixed at creation and not editable in the form afterwards.
  const onSelectAppType = (type: string) => {
    setNewAppOpen(false);
    applyViews((views) => showAppForm(views, "create", buildApp("", type, {}, {})));
  };

  const onEditApp = (appName: string) => {
    const app = apps.find((p) => p.configuration.name === appName);
    if (app) {
      applyViews((views) => showAppForm(views, "edit", app.configuration));
    }
  };

  const dropAppForm = () => {
    applyViews((views) => {
      const form = views.find((view) => view.type === "appForm");
      return form ? dropView(views, form.id) : views;
    });
  };

  const onAppFormSubmit = async (app: ConfigurationApp, originalName?: string) => {
    dropAppForm();

    if (!configuration) {
      return;
    }

    const isEdit = originalName !== undefined;
    const isNewApp = !isEdit;

    // Update configuration
    const updatedConfiguration: Configuration = {
      ...configuration,
      apps: isEdit ? (configuration.apps || []).map((a) => (a.name === originalName ? app : a)) : [...(configuration.apps || []), app],
    };

    // Save configuration via API and apply changes through unified path
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }

    if (isNewApp) {
      setAutoExpandApp({ name: app.name });
    }
  };

  const onAppFormCancel = () => {
    dropAppForm();
  };

  // Which apps reference each ${NAME}. Names no variable defines are in here
  // too: the Variables view shows them as a warning with the apps that use them.
  const variableUsage = useMemo(() => {
    const usage: { [name: string]: string[] } = {};
    for (const name of Object.keys(configuration?.variables ?? {})) {
      usage[name] = [];
    }
    for (const app of configuration?.apps ?? []) {
      const values = [...Object.values(appParameters(app)), ...Object.values(appHeaders(app))];
      for (const name of new Set(values.flatMap(variableReferences))) {
        (usage[name] ??= []).push(app.name);
      }
    }
    return usage;
  }, [configuration?.apps, configuration?.variables]);

  const onVariablesStateChange = useCallback((state: VariablesState) => {
    setVariablesState((previous) => (previous.dirty === state.dirty && previous.canSave === state.canSave && previous.save === state.save ? previous : state));
  }, []);

  const onVariablesClick = useCallback(() => {
    applyViews(showVariables);
  }, [applyViews]);

  // Saving the Variables view writes the configuration, which names the
  // variables, and clears what this machine was holding for a variable that
  // stopped being stored. Values going the other way don't come through here:
  // they are written the moment they are entered.
  const onVariablesSave = async ({ variables, cleared }: VariablesSave) => {
    if (!configuration) {
      return;
    }

    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: { ...configuration, variables } });

    let status = response.variableStatus;
    for (const name of cleared) {
      status = (await client.clearStoredValue({ name })).response.variableStatus;
    }
    setVariableStatus(status);

    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
  };

  // A value the machine holds is machine state, not file state, so it is written
  // when it is entered rather than waiting for a save that may never come.
  const onStoreVariableValue = async (name: string, value: string) => {
    const { response } = await getApiClient().setStoredValue({ name, value });
    setVariableStatus(response.variableStatus);
  };

  const onDeleteApp = async (appName: string) => {
    if (!configuration) {
      return;
    }

    // Update configuration to remove the app.
    const updatedConfiguration: Configuration = {
      ...configuration,
      apps: (configuration.apps || []).filter((a) => a.name !== appName),
    };

    // Save configuration via API and apply changes through unified path
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      applyConfiguration(response.configuration);
      // Refresh remaining editors to show broken import errors
      refreshOpenDraftEditors();
    }
  };

  // With the sidebar open its own header holds the macOS traffic lights; collapsed,
  // the command row is what the window's left corner lands on, so it takes over
  // the inset.
  const commandRowInset = isDesktopMac && sidebarCollapsed ? TRAFFIC_LIGHTS_INSET : 12;

  const currentIsEditor = currentView?.type === "draft" || currentView?.type === "script";
  const isHorizontalLayout = editorLayout === "horizontal" && currentIsEditor;

  const currentEditorContentHeight = currentIsEditor ? editorContentHeights[currentView.id] : undefined;
  const autoEditorHeight =
    currentEditorContentHeight === undefined
      ? undefined
      : Math.min(Math.max(currentEditorContentHeight, MIN_EDITOR_HEIGHT), Math.max(MIN_EDITOR_HEIGHT, Math.round(windowHeight * MAX_EDITOR_HEIGHT_RATIO)));
  const effectiveEditorHeight = editorHeightAuto && autoEditorHeight !== undefined ? autoEditorHeight : editorHeight;
  effectiveEditorHeightRef.current = effectiveEditorHeight;

  // Where you have been, most recent first. This is the mounted-view cache read
  // as history, which is all "recent" ever meant.
  const recent: Destination[] = views.map((view) => ({
    ...viewIdentity(view, drafts),
    key: view.id,
    go: () => onGoToView(view.id),
  }));

  // Everywhere else you can go. Typing narrows across both, which is what makes
  // the finder the only surface that can search the calls.
  const elsewhere = useMemo<Destination[]>(() => {
    const shownDrafts = new Set(views.filter((view) => view.type === "draft").map((view) => view.draftId));
    const shownScripts = new Set(views.filter((view) => view.type === "script").map((view) => view.script.path));
    const destinations: Destination[] = [];

    // Files and drafts sit in one run, in the two words the sidebar uses. The
    // folder is a file's qualifier, which is what tells two same-named ones in
    // different folders apart.
    for (const script of scripts ?? []) {
      if (shownScripts.has(script.path)) continue;
      destinations.push({
        key: `script:${script.path}`,
        name: script.name,
        // The folder reads as where it sits, on the same "benchling / Folders"
        // rule the rest of the list follows — and it is what the search matches,
        // so a folder name finds everything filed in it.
        path: script.folder ? `Files / ${script.folder}` : "Files",
        origin: script.folder,
        icon: FileCode,
        file: true,
        go: () => void onScriptSelect(script),
      });
    }

    for (const draft of drafts) {
      if (shownDrafts.has(draft.id)) continue;
      destinations.push({
        key: `draft:${draft.id}`,
        name: draft.title,
        path: "Drafts",
        origin: draft.agentClient ?? draft.originAppName ?? "",
        icon: isAgentDraft(draft) ? Plug : PenLine,
        provisional: isUntouched(draft),
        go: () => onDraftSelect(draft),
      });
    }

    // The workspace surfaces come before the calls: there are two of them and
    // hundreds of calls, so at rest they'd never make the list otherwise.
    if (!views.some((view) => view.type === "variables")) {
      destinations.push({ key: "variables", name: "Variables", path: "Workspace", origin: "", icon: Braces, go: onVariablesClick });
    }
    // With no apps there is nothing to have compiled, so the log is absent
    // rather than empty — going to it would land on the same blankslate you
    // were already looking at. The status bar's compile item is gone for the
    // same reason.
    if (apps.length > 0 && !views.some((view) => view.type === "compiler")) {
      destinations.push({ key: "compiler", name: "Compile log", path: "Output", origin: "", icon: ScrollText, go: () => onShowCompileLog() });
    }

    for (const app of apps) {
      // The tree says which package a service is in by where the row sits; a
      // flat list has to say it, and only where an app has more than one — that
      // is what tells two `Quirks.Sum` rows apart.
      const packages = hasMultiplePackages(app.services);
      for (const service of app.services) {
        const qualified = packages ? `${service.packageName}.${service.name}` : service.name;
        for (const method of service.methods) {
          destinations.push({
            // The package is part of the key for the same reason: without it the
            // two `Quirks.Sum` rows share one, and React renders whichever it
            // already had wherever the other belongs.
            key: `call:${app.configuration.name}/${service.packageName}.${service.name}/${method.name}`,
            name: method.name,
            path: `${app.configuration.name} / ${qualified}`,
            origin: app.configuration.name,
            icon: FileCode,
            go: () => void onMethodSelect(method, service, app),
          });
        }
      }
    }

    return destinations;
  }, [apps, drafts, scripts, views, onDraftSelect, onScriptSelect, onMethodSelect, onVariablesClick, onShowCompileLog]);

  // Which files have something in the air, so a run started on one script says
  // so while you are looking at another. Three sets the store keeps rather than
  // three walks of every call it holds.
  const { running: runningFiles, agent: agentFiles, waiting: waitingFiles } = consoles.flagSets();

  // What the empty state offers instead of an illustration: the last few things
  // you were in. On a first run there are none and the list is simply absent.
  const recentFiles = useMemo<RecentFile[]>(() => {
    const files: RecentFile[] = drafts.slice(0, 3).map((draft) => ({
      key: draft.id,
      name: draft.title,
      icon: PenLine,
      updatedAt: draft.updatedAt,
      saved: false,
      go: () => onDraftSelect(draft),
    }));
    for (const script of scripts ?? []) {
      if (files.length >= 3) break;
      files.push({ key: script.path, name: script.name, icon: FileCode, saved: true, go: () => void onScriptSelect(script) });
    }
    return files;
  }, [drafts, scripts, onDraftSelect, onScriptSelect]);

  /**
   * The pair you reach for mid-edit, beside the name of what it acts on: `Name`,
   * which is what turns a draft into a file, and a discard that closes the
   * buffer with it. Both are absent on a file, which is already on disk and
   * stays there as you type, and on the web, where nothing can write one.
   */
  const currentDraft = currentView?.type === "draft" ? drafts.find((draft) => draft.id === currentView.draftId) : undefined;
  const fileActions =
    currentDraft && canWriteScripts() ? (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRequestSave}
          className="flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-foreground hover:bg-accent"
        >
          <SaveIcon size={12} />
          Name
          <span className="font-mono text-muted-foreground">{navigator.platform.startsWith("Mac") ? "⌘S" : "Ctrl+S"}</span>
        </button>
        <IconButton
          icon={X}
          aria-label={`Discard ${currentDraft.title}`}
          variant="ghost"
          size="sm"
          className="size-6 [&_svg]:size-[13px]"
          onClick={() => onDiscardDraft(currentDraft)}
        />
      </div>
    ) : undefined;

  // Stop aborts what the button is showing, so it tracks this file's runs rather
  // than the file's in-flight state — a run started elsewhere says so in the
  // sidebar instead. The counter reads from the oldest of them, so pressing Run
  // again while one is going extends the count rather than restarting it.
  const runsHere = currentFileId === undefined ? [] : activeRuns.filter((live) => live.run.fileId === currentFileId);
  const running = runsHere.length > 0;
  const runningSince = running ? Math.min(...runsHere.map((live) => live.run.startedAt)) : undefined;
  // One button, in two places: the command row, and the bar of a canvas that has
  // taken the window. Reimplementing it there would be a second thing to keep in
  // step with what the file can do.
  const runButton = currentIsEditor ? (
    <RunButton
      onRun={() => onRunCurrentTab()}
      onStop={onStopActiveRun}
      running={running}
      startedAt={runningSince}
      error={syntaxErrors.first}
      // Only when this file reads `kaja.input`; there is nothing to ask for
      // otherwise, and a greyed item would make people hunt for the way to
      // enable it. The caret itself is on either way.
      onRunWithParameters={inputKeys.length > 0 ? onRunWithParameters : undefined}
      onCopyDeeplink={onCopyCurrentLink}
      onRevealInFinder={onRevealCurrentScript}
      // A draft's two verbs, the same pair the command row carries beside its
      // name — answering the moment you are already at this end of the row.
      onNameDraft={currentDraft && canWriteScripts() ? onRequestSave : undefined}
      onDiscardDraft={currentDraft ? () => onDiscardDraft(currentDraft) : undefined}
      onDuplicateAsDraft={currentView?.type === "script" && !canWriteScripts() ? onDuplicateAsDraft : undefined}
    />
  ) : undefined;
  const action =
    runButton ??
    (jsonView ? (
      <IconButton
        icon={Code}
        aria-label={jsonView.showing ? jsonView.back : "Edit as JSON (⌘J)"}
        variant="ghost"
        size="sm"
        className={cn("size-[26px]", jsonView.showing && "bg-accent text-foreground")}
        disabled={jsonView.showing && !viewJsonValid}
        onClick={toggleJsonView}
      />
    ) : undefined);

  // Bodies render in creation order, so bringing a file to the front never moves
  // a live editor in the DOM.
  const bodies = [...views].sort((a, b) => a.seq - b.seq);

  return (
    <>
      <div
        className="fixed inset-0 flex flex-col bg-background text-foreground"
        style={{
          overflow,
          WebkitOverflowScrolling: isNarrow ? "touch" : undefined,
          overscrollBehavior: isNarrow ? "contain" : "none",
        }}
      >
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {!sidebarCollapsed && (
            <div
              style={{
                width: isNarrow ? 250 : sidebarWidth,
                minWidth: sidebarMinWidth,
                maxWidth: 600,
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              <Sidebar
                apps={apps}
                canUpdateConfiguration={runtime.canUpdateConfiguration}
                onSelect={onMethodSelect}
                onShowCompileLog={onShowCompileLog}
                onRecompileApp={onRecompile}
                onNewAppClick={onNewAppClick}
                onNewScript={onNewDraft}
                onVariablesClick={onVariablesClick}
                autoExpandApp={autoExpandApp}
                reserveTrafficLights={isDesktopMac}
                onEditApp={onEditApp}
                onDeleteApp={onDeleteApp}
                scriptsRegion={
                  <ScriptsRegion
                    scripts={scripts ?? []}
                    folders={scriptFolders}
                    drafts={drafts}
                    currentDraftId={currentView?.type === "draft" ? currentView.draftId : undefined}
                    currentScriptPath={currentView?.type === "script" ? currentView.script.path : undefined}
                    runningFileIds={runningFiles}
                    agentFileIds={agentFiles}
                    waitingFileIds={waitingFiles}
                    canWrite={canWriteScripts()}
                    onDraftSelect={onDraftSelect}
                    onNameDraft={onNameDraft}
                    onDiscardDraft={onDiscardDraft}
                    onClearUntouched={onClearUntouched}
                    onClearAllDrafts={onClearAllDrafts}
                    sweepDrafts={sweepDrafts}
                    onToggleSweepDrafts={() => setSweepDrafts((on) => !on)}
                    onScriptSelect={onScriptSelect}
                    onRenameScript={canWriteScripts() ? onRenameScript : undefined}
                    onMoveScript={canWriteScripts() ? onMoveScript : undefined}
                    onDeleteScript={canWriteScripts() ? (script) => setDeleteScript(script) : undefined}
                    onCopyScriptLink={(script) => void onCopyScriptLink(script)}
                    onCreateFolder={canWriteScripts() ? onCreateFolder : undefined}
                    onRenameFolder={canWriteScripts() ? onRenameFolder : undefined}
                    onDeleteFolder={canWriteScripts() ? (path) => setDeleteFolder(path) : undefined}
                    onRevealScripts={isWailsEnvironment() ? onRevealScripts : undefined}
                  />
                }
              />
            </div>
          )}
          <Splitter orientation="vertical" onResize={onSidebarResize} hitAreaSize={sidebarCollapsed ? 12 : undefined} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: mainMinWidth, minHeight: 0 }}>
            <CommandRow
              leftInset={commandRowInset}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
              finder={
                <Finder
                  recent={recent}
                  elsewhere={elsewhere}
                  errorCount={currentIsEditor ? syntaxErrors.count : 0}
                  open={finder !== undefined}
                  onOpenChange={(open: boolean) => setFinder(open ? "first" : undefined)}
                  highlightPrevious={finder === "previous"}
                />
              }
              fileActions={fileActions}
              action={action}
              layout={editorLayout}
              onToggleLayout={onToggleEditorLayout}
            />
            {/* Which of the two nothing-open screens is right depends on
                whether the workspace names any apps, so until the configuration
                answers that, neither is shown. */}
            {views.length === 0 && configurationLoaded && apps.length === 0 && (
              <FirstAppBlankslate onNewAppClick={onNewAppClick} canUpdateConfiguration={runtime.canUpdateConfiguration} />
            )}
            {views.length === 0 && configurationLoaded && apps.length > 0 && (
              <NoFileBlankslate onOpenFinder={() => setFinder("first")} onNewDraft={onNewDraft} recent={recentFiles} />
            )}
            {views.length > 0 && (
              <div style={{ flex: 1, display: "flex", flexDirection: isHorizontalLayout ? "row" : "column", minHeight: 0 }}>
                <div
                  style={{
                    height: currentIsEditor && !isHorizontalLayout ? effectiveEditorHeight : undefined,
                    width: currentIsEditor && isHorizontalLayout ? editorWidth : undefined,
                    flexGrow: currentIsEditor ? 0 : 1,
                    flexShrink: 0,
                    flexBasis: currentIsEditor ? "auto" : 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    minWidth: 0,
                    overflow,
                  }}
                >
                  {bodies.map((view) => (
                    <div key={view.id} style={{ display: view.id === currentView?.id ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                      {view.type === "compiler" && (
                        <CompileLog
                          apps={apps}
                          configurationLoaded={configurationLoaded}
                          onNewAppClick={onNewAppClick}
                          canUpdateConfiguration={runtime.canUpdateConfiguration}
                          expandApp={compileLogExpandApp}
                        />
                      )}
                      {(view.type === "draft" || view.type === "script") && (
                        <div className="relative flex min-h-0 flex-1 flex-col">
                          {/* Somebody else is writing in this one, so the editor
                              follows rather than pretending you can type into a
                              buffer that is being rewritten under you. */}
                          {view.type === "draft" && agentViewClient(view.draftId) && (
                            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
                              <Plug size={13} className="shrink-0 text-muted-foreground" />
                              <span className="shrink-0 text-sm text-foreground">{agentViewClient(view.draftId)}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                agent draft · following {agentViewClient(view.draftId)}
                              </span>
                              <Button variant="outline" size="sm" className="h-6 shrink-0" onClick={() => onTakeOverAgentDraft(view.draftId)}>
                                Take over
                              </Button>
                            </div>
                          )}
                          {/* A file the server can't write is a file you read and
                              run, not one you edit into a change nothing would
                              keep. A draft beside it is unaffected: it lives in
                              this browser, so it is as writable here as anywhere. */}
                          <Editor
                            model={view.model}
                            onMount={(editor) => onEditorReady(view.id, editor)}
                            onGoToDefinition={onGoToDefinition}
                            viewState={view.viewState}
                            readOnly={(view.type === "script" && !canWriteScripts()) || (view.type === "draft" && agentViewClient(view.draftId) !== undefined)}
                          />
                        </div>
                      )}
                      {view.type === "definition" && (
                        <Definition
                          model={view.model}
                          onGoToDefinition={onGoToDefinition}
                          startLineNumber={view.startLineNumber}
                          startColumn={view.startColumn}
                        />
                      )}
                      {view.type === "appForm" && (
                        <AppForm
                          mode={view.mode}
                          initialData={view.initialData}
                          allApps={configuration?.apps ?? []}
                          variables={configuration?.variables ?? {}}
                          readOnly={!runtime.canUpdateConfiguration}
                          editMode={view.editMode}
                          onSubmit={onAppFormSubmit}
                          onCancel={onAppFormCancel}
                          onJsonValidChange={setViewJsonValid}
                        />
                      )}
                      {view.type === "variables" && (
                        <Variables
                          variables={configuration?.variables ?? {}}
                          status={variableStatus}
                          storeAvailable={runtime.variableStoreAvailable}
                          usage={variableUsage}
                          readOnly={!runtime.canUpdateConfiguration}
                          editMode={view.editMode}
                          onEditModeChange={(editMode) => applyViews((views) => setVariablesEditMode(views, view.id, editMode))}
                          onJsonValidChange={setViewJsonValid}
                          active={view.id === currentView?.id}
                          onSave={onVariablesSave}
                          onStoreValue={onStoreVariableValue}
                          onStateChange={onVariablesStateChange}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {currentIsEditor && (
                  <>
                    <Splitter
                      orientation={isHorizontalLayout ? "vertical" : "horizontal"}
                      onResize={isHorizontalLayout ? onEditorWidthResize : onEditorResize}
                    />
                    <div
                      style={{
                        flex: 1,
                        minHeight: isHorizontalLayout ? 0 : 100,
                        minWidth: isHorizontalLayout ? 100 : 0,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <Console
                        fileId={currentFileId}
                        reserveTrafficLights={isDesktopMac}
                        onAnswer={onAnswerAsk}
                        onCancelAsk={onCancelAsk}
                        onDecide={onDecideApproval}
                        tableViews={tableViews}
                        onTableView={onTableView}
                        onTablePull={onTablePull}
                        onTableCells={onTableCells}
                        onClear={currentFileId ? () => onClearConsole(currentFileId) : undefined}
                        presentRunId={presentRunId}
                        onPresented={() => setPresentRunId(undefined)}
                        runControl={runButton}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <StatusBar
          colorMode={colorMode}
          onToggleColorMode={onToggleColorMode}
          gitRef={runtime.gitRef}
          buildNumber={runtime.buildNumber}
          featurePreviews={featurePreviews}
          onToggleFeaturePreview={onToggleFeaturePreview}
          mcpInfo={mcpConnection}
          mcpActive={mcpActive}
          agent={agentFooter}
          apps={apps}
          configurationLoaded={configurationLoaded}
          onShowCompileLog={onShowCompileLog}
          onRecompile={onRecompile}
        />
      </div>
      {/* Naming a draft is what moves it into Files, so the sheet asks for the
          two things a file has that a draft doesn't: a name and a folder. It is
          the same sheet for a rename and a move, because on disk those write the
          same two fields. */}
      {nameSheet && (
        <Dialog
          title={nameSheet.title}
          onClose={() => {
            setNameSheet(null);
            setNameSheetError(undefined);
          }}
          footerButtons={[
            { content: "Cancel", onClick: () => setNameSheet(null) },
            { content: nameSheet.verb === "name" ? "Save" : nameSheet.verb === "move" ? "Move" : "Rename", variant: "default", onClick: onConfirmNameSheet },
          ]}
        >
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <div className="relative">
              {/* A draft reads as a call name and a file as a filename;
                  proposing the filename from the derived name is what keeps the
                  section from splitting into two conventions. */}
              <Input
                autoFocus={nameSheet.verb !== "move"}
                className="pr-9 font-mono"
                value={nameSheet.name}
                onChange={(e) => setNameSheet((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onConfirmNameSheet();
                  }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">.ts</span>
            </div>
          </FormControl>
          <FolderField
            value={nameSheet.folder}
            folders={scriptFolders}
            autoFocus={nameSheet.verb === "move"}
            onChange={(folder) => setNameSheet((prev) => (prev ? { ...prev, folder } : prev))}
            onSubmit={() => void onConfirmNameSheet()}
          />
          {nameSheetError && (
            <FormControl>
              <FormControl.Validation variant="error">{nameSheetError}</FormControl.Validation>
            </FormControl>
          )}
        </Dialog>
      )}
      {askPrompt && (
        <Dialog
          title="Input"
          onClose={() => {
            askPrompt.reject(new AskCancelledError());
            setAskPrompt(null);
          }}
          footerButtons={[
            {
              content: "Cancel",
              onClick: () => {
                askPrompt.reject(new AskCancelledError());
                setAskPrompt(null);
              },
            },
            {
              content: "Submit",
              variant: "default",
              onClick: () => submitAskPrompt(),
            },
          ]}
        >
          <FormControl>
            <FormControl.Label>{askPrompt.question.question}</FormControl.Label>
            {askPrompt.question.answerType === "select" ? (
              <Select value={askPrompt.value} onValueChange={(value) => setAskPrompt((prev) => (prev ? { ...prev, value: value ?? "" } : prev))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(askPrompt.question.choices ?? []).map((choice, index) => (
                    <SelectItem key={index} value={choice}>
                      {choice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                autoFocus
                inputMode={askPrompt.question.answerType === "int" ? "numeric" : undefined}
                placeholder={answerPlaceholder(askPrompt.question.answerType)}
                value={askPrompt.value}
                onChange={(e) => setAskPrompt((prev) => (prev ? { ...prev, value: e.target.value, problem: undefined } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitAskPrompt();
                  }
                }}
              />
            )}
            {askPrompt.problem && <FormControl.Validation variant="error">{askPrompt.problem}</FormControl.Validation>}
          </FormControl>
        </Dialog>
      )}
      {approvePrompt && (
        // The same three decisions the canvas offers, for a run that has no
        // canvas to draw them on. Dismissing the dialog is not approving, which
        // is the safe reading of a gesture that said nothing.
        <Dialog
          title="Approve call"
          onClose={() => {
            approvePrompt.reject(new ApprovalRejectedError());
            setApprovePrompt(null);
          }}
          footerButtons={[
            {
              content: "Stop",
              onClick: () => {
                approvePrompt.reject(new ApprovalRejectedError());
                setApprovePrompt(null);
              },
            },
            {
              content: `Approve all ${approvePrompt.call.method}`,
              variant: "secondary",
              onClick: () => {
                approvePrompt.resolve("all");
                setApprovePrompt(null);
              },
            },
            {
              content: "Approve",
              variant: "default",
              onClick: () => {
                approvePrompt.resolve("approved");
                setApprovePrompt(null);
              },
            },
          ]}
        >
          <div className="flex flex-col gap-2 font-mono text-xs">
            <div className="text-foreground">{approvePrompt.call.method}</div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background px-2.5 py-2 leading-relaxed text-foreground">
              {approvePrompt.call.request}
            </pre>
          </div>
        </Dialog>
      )}
      {linkPrompt && (
        // Anything that can open a URL can get this far, so the deeplink states
        // what it wants and stops. The script is open behind this, which is the
        // reading that makes the decision worth asking for — and every value it
        // carried is a field, correctable before the run.
        <ParameterSheet
          // A second deeplink arriving while this one is on screen is a
          // different question, so it gets a different sheet rather than the
          // first one's fields.
          key={`${linkPrompt.script.path}?${new URLSearchParams(linkPrompt.input).toString()}`}
          door="arrived"
          fileName={linkPrompt.script.name}
          address={scriptName(linkPrompt.script)}
          parameters={Object.keys(linkPrompt.input)}
          values={linkPrompt.input}
          onRun={(input) => void onConfirmScriptLink(linkPrompt.script, input)}
          onClose={() => setLinkPrompt(null)}
        />
      )}
      {linkSheet && (
        <ParameterSheet
          door="copy"
          fileName={linkSheet.script.name}
          address={scriptName(linkSheet.script)}
          parameters={linkSheet.parameters}
          onClose={() => setLinkSheet(null)}
        />
      )}
      {runPrompt && (
        <ParameterSheet
          door="run"
          fileName={runPrompt.fileName}
          parameters={runPrompt.parameters}
          lastRun={lastRunInput(runPrompt.fileId)}
          onRun={(input) => onRunCurrentTab(input)}
          onClose={() => setRunPrompt(null)}
        />
      )}
      {newAppOpen && <NewAppDialog appsPreviewEnabled={previewApps} onClose={() => setNewAppOpen(false)} onSelect={onSelectAppType} />}
      {deleteScript && (
        <ConfirmationDialog
          title="Delete file?"
          confirmButtonContent="Delete"
          confirmButtonType="danger"
          onClose={(gesture) => {
            const script = deleteScript;
            setDeleteScript(null);
            if (gesture === "confirm" && script) onConfirmDeleteScript(script);
          }}
        >
          Permanently delete{" "}
          <strong>
            <FileName name={deleteScript.name} />
          </strong>
          ?
        </ConfirmationDialog>
      )}
      {/* The dialog appears only when clearing costs something, and then it
          names the work at stake. Its two buttons are both actions, so closing
          it — Esc, the backdrop, the X — clears nothing: the safe path is the
          fast one, not the one you fall into. */}
      {clearAllPrompt && (
        <Dialog
          title={`Clear ${clearAllPrompt.all.length} ${clearAllPrompt.all.length === 1 ? "draft" : "drafts"}?`}
          onClose={() => setClearAllPrompt(null)}
          footerButtons={[
            {
              content: `Keep edited (${clearAllPrompt.all.length - clearAllPrompt.edited.length})`,
              onClick: () => {
                const untouched = clearAllPrompt.all.filter((draft) => !clearAllPrompt.edited.includes(draft));
                setClearAllPrompt(null);
                discardDrafts(untouched, `${untouched.length} untouched ${untouched.length === 1 ? "draft" : "drafts"} cleared`);
              },
            },
            {
              content: `Clear all ${clearAllPrompt.all.length}`,
              variant: "destructive",
              onClick: () => {
                const all = clearAllPrompt.all;
                setClearAllPrompt(null);
                discardDrafts(all, `${all.length} ${all.length === 1 ? "draft" : "drafts"} cleared`);
              },
            },
          ]}
        >
          <div className="flex flex-col gap-3">
            <span className="text-sm text-muted-foreground">
              {untouchedSentence(clearAllPrompt.all.length - clearAllPrompt.edited.length)} {clearAllPrompt.edited.length}{" "}
              {clearAllPrompt.edited.length === 1 ? "has edits that aren't" : "have edits that aren't"} saved anywhere:
            </span>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2">
              {clearAllPrompt.edited.map((draft) => (
                <span key={draft.id} className="truncate text-sm text-foreground">
                  {draft.title}
                </span>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {deleteFolder && (
        <ConfirmationDialog
          title="Delete folder?"
          confirmButtonContent="Delete"
          confirmButtonType="danger"
          onClose={(gesture) => {
            const path = deleteFolder;
            setDeleteFolder(null);
            if (gesture === "confirm" && path) void onConfirmDeleteFolder(path);
          }}
        >
          Delete <strong>{deleteFolder}</strong>? Only an empty folder can go — the files in one are deleted a file at a time.
        </ConfirmationDialog>
      )}
      {fileError && (
        <div style={{ position: "fixed", top: 36, left: "50%", transform: "translateX(-50%)", zIndex: 1000, maxWidth: 640 }}>
          <Alert variant="danger">{fileError}</Alert>
        </div>
      )}
      {/* Nothing was on disk, so discarding is taken back rather than confirmed
          up front. */}
      {discarded && (
        <div className="fixed bottom-10 left-1/2 z-[1000] flex h-9 -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-popover px-3 shadow-lg">
          <span className="text-sm text-muted-foreground">{discarded.label}</span>
          <button type="button" className="text-sm font-medium text-foreground hover:underline" onClick={onUndoDiscard}>
            Undo
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The folder half of the naming sheet. It lists the folders that exist plus
 * `New folder…`, so filing a draft somewhere new needs no trip to the sidebar
 * first — picking it turns the control into a field, and the folder is created
 * by the write itself.
 */
function FolderField({
  value,
  folders,
  autoFocus,
  onChange,
  onSubmit,
}: {
  value: string;
  folders: string[];
  autoFocus?: boolean;
  onChange: (folder: string) => void;
  onSubmit: () => void;
}) {
  const known = value === "" || folders.includes(value);
  const [typing, setTyping] = useState(!known);

  return (
    <FormControl>
      <FormControl.Label>Folder</FormControl.Label>
      {typing ? (
        <Input
          autoFocus
          className="font-mono"
          placeholder="reports"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setTyping(false);
              onChange("");
            }
          }}
        />
      ) : (
        <Select
          value={value}
          onValueChange={(next: string | null) => {
            if (next === NEW_FOLDER) {
              onChange("");
              setTyping(true);
              return;
            }
            onChange(next ?? "");
          }}
        >
          <SelectTrigger autoFocus={autoFocus}>
            <span className="flex min-w-0 items-center gap-2">
              <Folder size={13} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{value || "Files"}</span>
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Files</SelectItem>
            {folders.map((folder) => (
              <SelectItem key={folder} value={folder}>
                {folder}
              </SelectItem>
            ))}
            <SelectItem value={NEW_FOLDER}>New folder…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </FormControl>
  );
}

// "1 is untouched", "9 are untouched", and nothing at all when none is: the
// dialog only exists because some of them are work, so the other half is worth
// saying only when there is one.
function untouchedSentence(count: number): string {
  if (count === 0) return "None of them regenerate on demand.";
  return `${count} ${count === 1 ? "is" : "are"} untouched and regenerate${count === 1 ? "s" : ""} on demand.`;
}

// A value no folder can have, so picking it can't collide with one.
const NEW_FOLDER = "\u0000new";

// What the MCP server is told about a run. `result` is a value the script
// returned, which is nothing a script is supposed to do — it is carried so the
// report can correct it rather than swallow it.
interface McpRunReport {
  console: string[];
  result?: unknown;
  error?: string;
  methodCalls: unknown[];
  blocks?: unknown[];
}

// toBlockLog is the receipt for what a script drew: an agent's run has a canvas
// but nobody looking at it, so it is told the shape of what it made rather than
// the contents, which it produced and already has.
function toBlockLog(block: Block) {
  const table = block.kind === "table" ? block : undefined;
  return {
    kind: block.kind,
    label: blockLabel(block),
    columns: table?.columns,
    rows: table?.rows.length,
    // A live table drew the page it was asked for and left its source open. An
    // agent has nobody to press Next, so it is told the rows are a page rather
    // than the set — the loop that would fetch the rest is its own to write.
    more: table?.live === true && table.exhausted !== true ? true : undefined,
    // A cell that is a function is fetched when its row is drawn, and past the
    // first page nobody drew this one. A table with holes in it says so rather
    // than reading as a table of blanks.
    ...countCells(table),
  };
}

// The cells that hold no value, told apart by whether they are still coming or
// have stopped. Both are absent from a table whose cells are all values, which
// is every table that has none.
function countCells(table: TableBlock | undefined): { pending?: number; failed?: number } {
  let pending = 0;
  let failed = 0;
  for (const row of Object.values<{ [column: number]: CellStatus }>(table?.cells ?? {})) {
    for (const status of Object.values<CellStatus>(row)) {
      if (status.error === undefined) pending++;
      else failed++;
    }
  }
  return { pending: pending || undefined, failed: failed || undefined };
}

// toMethodCallLog flattens a MethodCall into the shape the MCP server returns to
// the agent: which method ran, what it was sent and what came back, and - when it
// failed - which kind of failure it was, so a caller can tell "fix your request"
// from "nothing you send will help".
function toMethodCallLog(call: MethodCall) {
  return {
    app: call.appName,
    service: call.service.name,
    method: call.method.name,
    durationMs: call.durationMs,
    input: call.input,
    output: call.output,
    failure: call.error === undefined ? undefined : classifyFailure(call.error),
  };
}
