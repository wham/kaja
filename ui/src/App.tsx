import { useMediaQuery } from "./useMediaQuery";
import { Alert } from "./components/alert";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { Braces, Code, FileCode, PenLine, Save as SaveIcon, ScrollText, X } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { CommandRow } from "./CommandRow";
import { Console } from "./Console";
import { ConsoleTab, ConsoleView, newRunId, Run, RunSelection } from "./runs";
import {
  adoptStoredRuns,
  clearFile,
  dropFile,
  fileConsole,
  findBlock,
  hasCallsInFlight,
  putFile,
  recordBlock,
  recordCall,
  recordLogs,
  renameFile,
  RunHistory,
  agentFileIds,
  runningFileIds,
  setSelection,
  setTab,
  setView,
  settleRun,
  startRun,
  takeFile,
  waitingFileIds,
  FileConsole,
} from "./runHistory";
import { dropStoredFile, loadRuns, renameStoredFile, saveRuns } from "./runStore";
import { NoFileBlankslate, RecentFile } from "./NoFileBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Destination, Finder } from "./Finder";
import { Gutter } from "./Gutter";
import { answerPlaceholder, answerProblem, normalizeAnswer } from "./ask";
import { AskBlock, Block, blockLabel } from "./blocks";
import { AskCancelledError, Kaja, MethodCall } from "./kaja";
import { TableView } from "./tableView";
import { appHeaders, appParameters, appType, buildApp } from "./appTypes";
import { createPendingApp, getDefaultMethod, Method, App as AppModel, Script, Service, updateAppRef } from "./apps";
import { appendCall, createScratch, findUntouched, isUntouched, markRun, pruneScratches, reopen, Scratch, takeOver, withCode } from "./scratches";
import { deriveScratchTitle, proposeFileName, proposeFileNames } from "./scratchTitle";
import { methodUse, recordUse } from "./treeExpansion";
import { generateMethodEditorCode } from "./appLoader";
import { buildMcpCatalog } from "./mcpCatalog";
import { classifyFailure } from "./callFailure";
import { RunButton, useSyntaxErrors } from "./RunButton";
import { Sidebar, TRAFFIC_LIGHTS_INSET } from "./Sidebar";
import { NewAppDialog } from "./NewAppDialog";
import { StatusBar, ColorMode } from "./StatusBar";
import { FeaturePreview } from "./FeaturePreviews";
import { AppForm } from "./AppForm";
import { Editor, registerKajaModule, setValueCompletionApps } from "./Editor";
import { formatTypeScript } from "./formatter";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { Configuration, ConfigurationApp, LogLevel, Runtime, VariableStatus } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  dropView,
  PersistedViewState,
  restoreViews,
  serializeViews,
  setAppFormEditMode,
  setVariablesEditMode,
  showAppForm,
  showCompiler,
  showDefinition,
  showScratch,
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
  CreateScript,
  DeleteScript,
  ListScripts,
  MCPScriptResult,
  MCPServerInfo,
  MCPSetCatalog,
  MCPSetEnabled,
  ReadScriptFile,
  RenameScript,
  ResolvedVariables,
  WriteScriptFile,
} from "./wailsjs/go/main/App";
import { main } from "./wailsjs/go/models";
import { runTask, runTaskCaptured } from "./taskRunner";

// How long a discarded scratch is held before it is really gone. Nothing was on
// disk, so this is undo rather than a confirmation.
const UNDO_DISCARD_MS = 8000;

// How long the footer keeps saying the MCP server is in use after the last
// request was answered. A burst of calls is over in milliseconds, so without it
// the indicator would be gone before it was seen.
const MCP_ACTIVITY_LINGER_MS = 2500;

// Scratch ids the last session had open, so start-up pruning can't drop one
// that is about to reopen.
function openScratchIds(): string[] {
  const persisted = getPersistedValue<PersistedViewState>("views");
  return (persisted?.views ?? []).flatMap((tab) => ("scratchId" in tab ? [tab.scratchId] : []));
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

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  // The running kaja, as opposed to the workspace it serves. It arrives alongside
  // the configuration but is not part of it, and holds until the process exits.
  const [runtime, setRuntime] = useState<Runtime>(Runtime.create());
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  // Where each variable's value came from. A value the configuration only names
  // never travels, so this is all the Variables tab knows about it.
  const [variableStatus, setVariableStatus] = useState<VariableStatus[]>([]);
  // What the Variables tab holds that nothing else does: whether it is dirty,
  // whether it could save, and how to make it. The tab strip marks the dot and
  // the close gesture offers the save, so both live out here.
  const [variablesState, setVariablesState] = useState<VariablesState>({ dirty: false, canSave: false, save: async () => {} });
  const variablesStateRef = useRef(variablesState);
  variablesStateRef.current = variablesState;
  const [apps, setApps] = useState<AppModel[]>([]);
  // Every scratch ever made, newest activity first — unlimited, kept in the
  // app, named from its own code. Independent of what is open: closing a tab
  // puts a scratch away, it doesn't throw it out.
  const [scratches, setScratches] = useState<Scratch[]>(() =>
    pruneScratches(getPersistedValue<Scratch[]>("scratches") ?? [], Date.now(), new Set(openScratchIds())),
  );
  // The open files, most-recently-visited first: views[0] is what the window is
  // showing. Nothing else records which file is current.
  const [views, setViews] = useState<View[]>(() =>
    restoreViews(getPersistedValue<PersistedViewState>("views"), getPersistedValue<Scratch[]>("scratches") ?? []),
  );
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
  // Every file's console: its runs, the calls under them, and where it was left
  // pointing. The console belongs to the file, so this is keyed by file and not
  // held on the view — views are a cache and get evicted.
  const [history, setHistory] = useState<RunHistory>({});
  const historyRef = useRef(history);
  historyRef.current = history;
  // The run calls are being attributed to. Cleared once the run settles, so a
  // stray call afterwards starts one of its own rather than joining a run that
  // is over.
  const currentRunRef = useRef<Run | null>(null);
  // Whether the finder is open, and where it opened: ⌘P lands on the previous
  // file so ⌘P⏎ goes back, a click on the trigger on the first row.
  const [finder, setFinder] = useState<"first" | "previous">();
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const scratchesRef = useRef(scratches);
  scratchesRef.current = scratches;
  const editorRegistryRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());
  const hasViewMemory = useRef(getPersistedValue<PersistedViewState>("views") !== undefined);
  const viewsRestoredRef = useRef(views.some((tab) => tab.type === "scratch"));
  const [scripts, setScripts] = useState<Script[]>();
  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;
  // "Preview Apps" toggle: reveals the experimental built-in app types in the New
  // dialog (openapi/openai/markdown). gRPC/Twirp are always available.
  const [previewApps, setPreviewApps] = usePersistedState("featurePreview:previewApps", false);
  const previewAppsRef = useRef(previewApps);
  previewAppsRef.current = previewApps;
  // Experimental "MCP server" feature (desktop only): exposes script edit/run and
  // the service catalog to an agent over a localhost MCP endpoint.
  const [previewMcp, setPreviewMcp] = usePersistedState("featurePreview:mcp", false);
  const [mcpInfo, setMcpInfo] = useState<main.MCPInfo | undefined>();
  // Whether an agent is using the server right now, which the footer's plug
  // shows. It outlives the request that set it (see MCP_ACTIVITY_LINGER_MS).
  const [mcpActive, setMcpActive] = useState(false);
  // While an MCP run_script call is in flight, the method calls it makes are
  // collected here so they can be returned to the agent.
  const mcpRunCollectorRef = useRef<MethodCall[] | null>(null);
  // And what it drew, keyed by block id — a table arrives once per row, so the
  // last state of each block is what the agent is told about.
  const mcpBlockCollectorRef = useRef<Map<string, Block> | null>(null);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const [fileError, setFileError] = useState<string | undefined>();
  // Save-as dialog state for ⌘S; null when closed.
  // Saving is what turns a scratch into a file. The scratch it came from goes
  // away with it — the same buffer, now on disk.
  const [saveAs, setSaveAs] = useState<{ name: string; content: string; fromScratchId?: string } | null>(null);
  const [saveAsError, setSaveAsError] = useState<string>();
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
  // Whether the New app dialog is open.
  const [newAppOpen, setNewAppOpen] = useState(false);
  // Whether the active tab's JSON parses. It gates switching back to the form or
  // the table, which is why it lives out here with the control that does the
  // switch.
  const [viewJsonValid, setTabJsonValid] = useState(true);
  const viewJsonValidRef = useRef(viewJsonValid);
  viewJsonValidRef.current = viewJsonValid;
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // One-shot signal to expand an app's logs when the compile log is opened for it.
  const [compileLogExpandApp, setCompileLogExpandApp] = useState<{ name: string }>();
  // Rename dialog and delete confirmation for scripts (right-click menu).
  const [renameScript, setRenameScript] = useState<{ script: Script; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  // The Scripts header's bulk verbs, each confirmed against the list it is about
  // to act on. Nothing here can reach a saved script.
  const [bulkScratches, setBulkScratches] = useState<{ verb: "save" | "discard"; scratches: Scratch[] } | null>(null);
  // Path of the script pinned to the macOS "Run Kaja Script" text service.
  const [pinnedScriptPath, setPinnedScriptPath] = useState<string | undefined>(() => getPersistedValue<string>("contextMenuScriptPath"));
  // The run in flight, if any: which tab issued it, when it started, and the
  // controller its Stop button aborts. `settled` marks the script itself as
  // finished — the run is only over once its calls have landed too.
  const [activeRun, setActiveRun] = useState<{ runId: string; fileId?: string; startedAt: number; controller?: AbortController; settled: boolean } | null>(
    null,
  );
  // A discarded scratch, held long enough to take it back. Nothing was on disk,
  // so discarding is undoable rather than confirmed.
  const [discarded, setDiscarded] = useState<{ scratch: Scratch; runs?: FileConsole } | null>(null);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending debounced disk writes for open script views, keyed by tab id.
  const scriptSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Tab ids whose next content change is a programmatic revalidation poke (see
  // refreshOpenScriptEditors), not a user edit — skip the debounced disk save.
  const suppressScriptSave = useRef(new Set<string>());
  // Pending debounced writes of scratch text back to the store, keyed by scratch id.
  const scratchSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const showFileError = useCallback((message: string) => {
    setFileError(message);
    window.setTimeout(() => setFileError((current) => (current === message ? undefined : current)), 4000);
  }, []);

  // Flush a script tab's pending debounced write immediately (e.g. before its
  // model is disposed). No-op if nothing is pending.
  const flushScriptWrite = useCallback(
    (tab: View) => {
      if (tab.type !== "script") return;
      const timer = scriptSaveTimers.current.get(tab.id);
      if (!timer) return;
      clearTimeout(timer);
      scriptSaveTimers.current.delete(tab.id);
      WriteScriptFile(tab.script.path, tab.model.getValue()).catch((err) => showFileError(`Save failed: ${err}`));
    },
    [showFileError],
  );

  const persistViews = useCallback(() => {
    setPersistedValue(
      "views",
      serializeViews(viewsRef.current, (viewId) => editorRegistryRef.current.get(viewId)?.saveViewState()),
    );
  }, []);

  // Every change to a scratch goes through here: the list is kept newest-first
  // and written straight through, because a scratch has no save step — it is
  // already kept.
  const applyScratches = useCallback((update: (scratches: Scratch[]) => Scratch[]) => {
    const next = update(scratchesRef.current);
    if (next === scratchesRef.current) return;
    const ordered = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
    scratchesRef.current = ordered;
    setScratches(ordered);
    setPersistedValue("scratches", ordered);
  }, []);

  const updateScratch = useCallback(
    (id: string, change: (scratch: Scratch) => Scratch) => {
      applyScratches((list) => {
        const index = list.findIndex((scratch) => scratch.id === id);
        return index === -1 ? list : list.map((scratch, i) => (i === index ? change(scratch) : scratch));
      });
    },
    [applyScratches],
  );

  const disposeView = useCallback(
    (tab: View) => {
      if (tab.type !== "scratch" && tab.type !== "script") return;
      flushScriptWrite(tab);
      editorRegistryRef.current.delete(tab.id);
      setEditorContentHeights(({ [tab.id]: _removed, ...rest }) => rest);
      tab.model.dispose();
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
      if (current?.type === "scratch" || current?.type === "script") {
        const editor = editorRegistryRef.current.get(current.id);
        if (editor) current.viewState = editor.saveViewState() ?? undefined;
      }

      const next = update(previous);
      if (next === previous) return;

      const kept = new Set(next.map((tab) => tab.id));
      for (const tab of previous) {
        if (!kept.has(tab.id)) disposeView(tab);
      }

      viewsRef.current = next;
      setViews(next);
      persistViews();
    },
    [disposeView, persistViews],
  );

  // One press of Run opens a run; everything the script does lands under it, in
  // the console of the file it was pressed on. Nothing else creates one, except
  // a call that arrives with no run open — which gets a run of its own rather
  // than joining one that is over, under the file the last run came from.
  const lastRunFileIdRef = useRef<string | undefined>(undefined);
  const beginRun = useCallback((title: string, fileId?: string, controller?: AbortController, of?: Pick<Run, "origin">): Run => {
    const run: Run = { id: newRunId(), title, fileId, startedAt: Date.now(), ...of };
    currentRunRef.current = run;
    if (fileId) lastRunFileIdRef.current = fileId;
    setHistory((current) => startRun(current, run, run.startedAt));
    setActiveRun({ runId: run.id, fileId, startedAt: run.startedAt, controller, settled: false });
    return run;
  }, []);

  const beginRunRef = useRef(beginRun);
  beginRunRef.current = beginRun;

  // A call arriving with no run open gets one, under the file the last run came
  // from — that is where a late call almost certainly belongs. A run with no
  // file at all (an agent running code that was never saved) has no console to
  // land in and is not kept; the agent still gets its results.
  const openRun = useCallback(
    (title: string): Run => {
      const current = currentRunRef.current;
      if (current) return current;
      // Paging a live table fetches after its run is over, and those rows belong
      // to the run whose canvas asked for them rather than to a run of their own.
      // A script running at the same time outranks it: that one is definitely
      // making the call being reported.
      const pulling = pullRunRef.current;
      if (pulling) return pulling;
      return beginRun(title, lastRunFileIdRef.current);
    },
    [beginRun],
  );

  const onMethodCallUpdate = useCallback(
    (methodCall: MethodCall) => {
      const collector = mcpRunCollectorRef.current;
      if (collector) {
        const i = collector.findIndex((m) => m.id === methodCall.id);
        if (i > -1) collector[i] = methodCall;
        else collector.push(methodCall);
      }
      // A call a script actually made counts as much as one picked out of the
      // tree, and more of them are made this way once you are working.
      recordUse(methodUse(methodCall.appName, methodCall.service, methodCall.method));
      const run = openRun(methodCall.method.name);
      setHistory((current) => recordCall(current, run.fileId, run.id, methodCall, Date.now()));
    },
    [openRun],
  );

  // Show a failed script run in the console; a script that dies silently looks
  // like it succeeded. Mirrored to console.error so it also lands in kaja.log.
  const onScriptError = useCallback(
    (error: unknown) => {
      console.error("Script error:", error);
      const message = error instanceof Error ? (error.name === "Error" ? error.message : `${error.name}: ${error.message}`) : String(error);
      const run = openRun("Script error");
      setHistory((current) => recordLogs(current, run.fileId, run.id, [{ level: LogLevel.LEVEL_ERROR, message }], Date.now()));
    },
    [openRun],
  );

  // Something the script drew. Blocks arrive more than once — a table paints row
  // by row — so they are recorded against their own id rather than appended.
  const onBlockUpdate = useCallback(
    (blockId: string, block: Block) => {
      // A run made for the MCP server draws on a canvas nobody is watching, so
      // what it drew is collected here and reported back as the receipt.
      mcpBlockCollectorRef.current?.set(blockId, block);
      const run = openRun("Script output");
      setHistory((current) => recordBlock(current, run.fileId, run.id, blockId, block, Date.now()));
    },
    [openRun],
  );

  /**
   * A `kaja.ask*` is answered on the canvas of the run that asked it, so the
   * promise waits here keyed by the block the question was drawn as. A run with
   * no console has no canvas to draw on — an agent running code that was never
   * saved — and falls back to the dialog, which needs no surface of its own.
   */
  const pendingAsksRef = useRef(new Map<string, { resolve: (answer: string) => void; reject: (error: unknown) => void }>());

  const onAsk = useCallback((question: AskBlock, blockId: string) => {
    return new Promise<string>((resolve, reject) => {
      if (!currentRunRef.current?.fileId) {
        // A select opens on its first option, since the dialog has one field and
        // it has to hold something.
        setAskPrompt({ question, value: question.answerType === "select" ? (question.choices?.[0] ?? "") : "", resolve, reject });
        return;
      }
      pendingAsksRef.current.set(blockId, { resolve, reject });
    });
  }, []);

  const settleAsk = useCallback((blockId: string, settle: (pending: { resolve: (answer: string) => void; reject: (error: unknown) => void }) => void) => {
    const pending = pendingAsksRef.current.get(blockId);
    if (!pending) return;
    pendingAsksRef.current.delete(blockId);
    settle(pending);
  }, []);

  const onAnswerAsk = useCallback((blockId: string, answer: string) => settleAsk(blockId, (pending) => pending.resolve(answer)), [settleAsk]);
  const onCancelAsk = useCallback((blockId: string) => settleAsk(blockId, (pending) => pending.reject(new AskCancelledError())), [settleAsk]);

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

  const kajaRef = useRef<Kaja>(null);
  if (!kajaRef.current) {
    kajaRef.current = new Kaja(onMethodCallUpdate, onAsk, onBlockUpdate);
  }

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

  // The run that a table is being filled for, which is what a call made by the
  // pull is recorded against.
  const pullRunRef = useRef<Run | null>(null);

  /**
   * Fill a live table further — the next page, or the first page of a new
   * search. A source that is no longer held (a run read back from an earlier
   * session, or one let go to keep the closures bounded) can't be pulled, and
   * the table says so rather than offering a Next that leads nowhere.
   */
  const onTablePull = useCallback(async (blockId: string, search: string, want: number) => {
    const found = findBlock(historyRef.current, blockId);
    const table = found?.block;
    if (!found || table?.kind !== "table") return;

    const previous = pullRunRef.current;
    pullRunRef.current = found.run;
    try {
      const live = await kajaRef.current!.pullTable(blockId, search, want);
      if (!live) {
        setHistory((current) => recordBlock(current, found.fileId, found.run.id, blockId, { ...table, live: false, expired: true }, Date.now()));
      }
    } finally {
      pullRunRef.current = previous;
    }
  }, []);

  // Clearing a file's history clears what is being held of it for next time too;
  // leaving yesterday's run behind would make "cleared" a half-truth.
  const onClearConsole = useCallback((fileId: string) => {
    setHistory((current) => clearFile(current, fileId, Date.now()));
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

  // Scripts and the MCP server are desktop-only, so those toggles are only offered
  // in the Wails environment. gRPC/Twirp apps are always enabled; the Preview Apps
  // toggle only reveals the experimental built-in app types (openapi/openai/markdown).
  const featurePreviews: FeaturePreview[] = [
    ...(isWailsEnvironment() ? [{ key: "mcp", label: "MCP server", enabled: previewMcp }] : []),
    { key: "previewApps", label: "Preview Apps", enabled: previewApps },
  ];

  const onToggleFeaturePreview = useCallback((key: string) => {
    if (key === "mcp") {
      setPreviewMcp((enabled) => !enabled);
    } else if (key === "previewApps") {
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
  const refreshOpenScratchEditors = useCallback(() => {
    viewsRef.current.forEach((tab) => {
      if (tab.type === "scratch") {
        const value = tab.model.getValue();
        tab.model.setValue(value);
      }
    });
  }, []);

  // Poke open script editors so TypeScript re-resolves service-module imports
  // (e.g. "app/service") once their backing source models exist. Script models
  // are frequently created (on tab restore or open) before compilation produces
  // the service definitions, so the TS worker caches "cannot find module" and
  // never clears it on its own. Use an identity edit — not setValue — to keep
  // undo history, and suppress the auto-save it would otherwise trigger.
  const refreshOpenScriptEditors = useCallback(() => {
    viewsRef.current.forEach((tab) => {
      if (tab.type === "script") {
        // onDidChangeContent fires synchronously within pushEditOperations, so
        // bracketing the poke leaves the set empty afterwards — a later real
        // edit is never mistaken for a poke even if the edit fires no event.
        suppressScriptSave.current.add(tab.id);
        tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: tab.model.getValue() }], () => null);
        suppressScriptSave.current.delete(tab.id);
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

        // A scratch isn't bound to an app — deleting one leaves the scratch
        // alone, it just stops compiling. Only a rename needs following, so the
        // imports keep resolving.
        if (renames.size > 0) {
          viewsRef.current.forEach((tab) => {
            if (tab.type !== "scratch") return;
            let value = tab.model.getValue();
            for (const [oldName, newName] of renames) {
              value = remapEditorCode(value, oldName, newName);
            }
            if (value !== tab.model.getValue()) {
              tab.model.setValue(value);
              updateScratch(tab.scratchId, (scratch) => ({ ...scratch, code: value }));
            }
          });
        }

        return updatedApps;
      });
    },
    [syncAppsFromConfiguration, updateScratch],
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
    if (!kajaRef.current) return;
    // Scripts read resolved values, including the ones kaja.json only names.
    // That is the desktop only: its UI runs inside the app's own process, so
    // there is no remote browser being handed a value it shouldn't have. On the
    // web the configuration's own text is all there is — and no scripts to read
    // it.
    if (isWailsEnvironment()) {
      ResolvedVariables()
        .then((resolved) => {
          if (kajaRef.current) kajaRef.current.variables = resolved;
        })
        .catch((error) => console.error("Failed to read the resolved variables", error));
    } else {
      kajaRef.current.variables = variables;
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

  // A scratch names itself from its own code, so the window follows the list
  // rather than the view: running or appending re-derives the title without the
  // view itself changing, and reading it through a ref would leave the window on
  // the name the row has already stopped showing.
  useEffect(() => {
    const current = views[0];
    let title = "Kaja";
    if (current?.type === "scratch") {
      title = `${viewIdentity(current, scratches).name} - Kaja`;
    } else if (current?.type === "script") {
      title = `${current.script.name} - Kaja`;
    }
    document.title = title;
    if (isWailsEnvironment()) {
      WindowSetTitle(title);
    }
  }, [views, scratches]);

  // Load the global scripts directory (desktop only). Scripts are independent
  // of apps; they bind to an app at run time via their import paths.
  const refreshScripts = useCallback(() => {
    if (!isWailsEnvironment()) {
      setScripts(undefined);
      return;
    }
    ListScripts()
      .then((list) => setScripts((list ?? []).map((s) => ({ path: s.path, name: s.name })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((err) => {
        console.error("Failed to list scripts", err);
        setScripts([]);
      });
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
        onNewScratchRef.current();
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
      for (const tab of viewsRef.current) {
        if (tab.type === "script" && scriptSaveTimers.current.has(tab.id)) {
          clearTimeout(scriptSaveTimers.current.get(tab.id)!);
          WriteScriptFile(tab.script.path, tab.model.getValue()).catch(() => {});
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

    // A source model appearing after a script tab's own model was created does
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

      // Restored scratches were created before the source models existed, so
      // poke their editors to revalidate now that the imports resolve.
      if (viewsRestoredRef.current) {
        viewsRestoredRef.current = false;
        refreshOpenScratchEditors();
        return;
      }

      // Only auto-open the first method on first-time use (no previous tab memory)
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
   * Clicking a method never asks what to do with it. The current scratch
   * decides: an untouched one is a browsing buffer and gets taken over, a
   * worked-in one is left alone and the call starts a new scratch — unless an
   * untouched scratch already holds exactly this call, which is reopened rather
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
      const currentScratch = current?.type === "scratch" ? scratchesRef.current.find((s) => s.id === current.scratchId) : undefined;

      if (mode === "append" && current?.type === "scratch" && currentScratch) {
        const merged = await formatTypeScript(appendCall(current.model.getValue(), code));
        current.model.setValue(merged);
        updateScratch(currentScratch.id, (scratch) => withCode(scratch, merged, now));
        return;
      }

      // An untouched scratch holding exactly this call is the buffer this click
      // would produce, so it is reopened instead. This is decided before the
      // takeover, which would otherwise be the thing that made the duplicate.
      const held = findUntouched(scratchesRef.current, code, originAppName);
      if (held) {
        updateScratch(held.id, (scratch) => reopen(scratch, now));
        applyViews((views) => showScratch(views, held));
        return;
      }

      if (currentScratch && isUntouched(currentScratch)) {
        current.type === "scratch" && current.model.setValue(code);
        updateScratch(currentScratch.id, (scratch) => takeOver(scratch, code, originAppName, now));
        return;
      }

      const scratch = createScratch(code, originAppName, now);
      applyScratches((list) => [scratch, ...list]);
      applyViews((views) => showScratch(views, scratch));
    },
    [applyScratches, applyViews, updateScratch],
  );

  const onScratchSelect = useCallback(
    (scratch: Scratch) => {
      applyViews((views) => showScratch(views, scratch));
    },
    [applyViews],
  );

  // Discarding an unsaved script takes nothing off disk, so it is undone rather
  // than confirmed: the row goes, and a bar offers it back for a few seconds.
  const onDiscardScratch = useCallback(
    (scratch: Scratch) => {
      const shown = viewsRef.current.find((view) => view.type === "scratch" && view.scratchId === scratch.id);
      if (shown) applyViews((views) => dropView(views, shown.id));
      applyScratches((list) => list.filter((candidate) => candidate.id !== scratch.id));
      // The console goes with the script, and is held alongside it so taking the
      // discard back brings the runs back too.
      const [remaining, taken] = takeFile(historyRef.current, scratch.id);
      setHistory(remaining);
      dropStoredFile(scratch.id);
      if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
      setDiscarded({ scratch, runs: taken });
      discardTimerRef.current = setTimeout(() => setDiscarded(null), UNDO_DISCARD_MS);
    },
    [applyScratches, applyViews],
  );

  const onUndoDiscard = useCallback(() => {
    if (discardTimerRef.current) clearTimeout(discardTimerRef.current);
    setDiscarded((held) => {
      if (held) {
        applyScratches((list) => [held.scratch, ...list]);
        if (held.runs) {
          setHistory((current) => putFile(current, held.scratch.id, held.runs!));
          saveRuns(held.scratch.id, held.runs.runs, held.runs.items);
        }
      }
      return null;
    });
  }, [applyScratches]);

  // A blank script, for when you know what you want to write and don't need a
  // call to start it. The empty state names the key, so it has to exist.
  const onNewScratch = useCallback(() => {
    const scratch = createScratch("", undefined, Date.now());
    applyScratches((list) => [scratch, ...list]);
    applyViews((views) => showScratch(views, scratch));
  }, [applyScratches, applyViews]);
  const onNewScratchRef = useRef(onNewScratch);
  onNewScratchRef.current = onNewScratch;

  /**
   * The buffer an agent explores in. A snippet it sends has no file of its own,
   * so it is given the same one every time: eight tries at a call are eight runs
   * of one scratch — which is what makes them comparable in the history — rather
   * than a trail of eight rows in the sidebar. It is an ordinary scratch in every
   * other way, titled from its own code and free to be saved or discarded; if it
   * goes, the next snippet starts another. Which one it is outlives the window,
   * or every restart would leave one more buffer behind that nothing reuses.
   */
  const agentScratchIdRef = useRef<string | undefined>(getPersistedValue<string>("agentScratchId"));
  const agentScratch = useCallback(
    (code: string): Scratch => {
      const now = Date.now();
      const held = scratchesRef.current.find((scratch) => scratch.id === agentScratchIdRef.current);
      // A run is the punctuation that settles a scratch, and one is about to
      // happen — so the title is re-read from the code now, as any run does.
      const scratch = markRun(held ?? createScratch(code, undefined, now), code, now);
      agentScratchIdRef.current = scratch.id;
      setPersistedValue("agentScratchId", scratch.id);
      applyScratches((list) => (held ? list.map((candidate) => (candidate.id === scratch.id ? scratch : candidate)) : [scratch, ...list]));
      // If the buffer is on screen, it shows what is about to run in it.
      const view = viewsRef.current.find((candidate) => candidate.type === "scratch" && candidate.scratchId === scratch.id);
      if (view?.type === "scratch" && view.model.getValue() !== code) view.model.setValue(code);
      return scratch;
    },
    [applyScratches],
  );
  const agentScratchRef = useRef(agentScratch);
  agentScratchRef.current = agentScratch;

  /**
   * The agent saved its buffer as a file, so the buffer goes with it rather than
   * lingering as a copy — the same rule a person's Save follows, and the runs
   * follow the file the same way. Only an exact copy is the same document: a
   * script the agent wrote differently from what it ran is a new one, and the
   * buffer it explored in stays where it is.
   */
  const consumeAgentScratch = useCallback(
    (script: Script, content: string) => {
      const id = agentScratchIdRef.current;
      const scratch = id ? scratchesRef.current.find((candidate) => candidate.id === id) : undefined;
      if (!id || !scratch || scratch.code !== content) return;
      agentScratchIdRef.current = undefined;
      setPersistedValue("agentScratchId", undefined);
      const shown = viewsRef.current.find((view) => view.type === "scratch" && view.scratchId === id);
      applyViews((views) => (shown ? dropView(showScript(views, script, content), shown.id) : views));
      applyScratches((list) => list.filter((candidate) => candidate.id !== id));
      setHistory((current) => renameFile(current, id, script.path));
      renameStoredFile(id, script.path);
    },
    [applyScratches, applyViews],
  );

  const onScriptSelect = useCallback(
    async (script: Script) => {
      if (!isWailsEnvironment()) return;
      try {
        const file = await ReadScriptFile(script.path);
        if (!file) return;
        applyViews((views) => showScript(views, { path: file.path, name: file.name }, file.content));
      } catch (err) {
        showFileError(`Open failed: ${err}`);
      }
    },
    [applyViews, showFileError],
  );

  // Persist the pinned script path so the macOS text service keeps targeting it
  // across restarts.
  useEffect(() => {
    setPersistedValue("contextMenuScriptPath", pinnedScriptPath);
  }, [pinnedScriptPath]);

  // Right-click → toggle which script the macOS "Run Kaja Script" service runs.
  const onPinScript = useCallback((script: Script) => {
    setPinnedScriptPath((current) => (current === script.path ? undefined : script.path));
  }, []);

  // Run the pinned script with text handed over by the macOS text service,
  // exposing it to the script as `kaja.input`.
  const runContextMenuScript = useCallback(
    async (text: string) => {
      if (!isWailsEnvironment()) return;
      if (!pinnedScriptPath) {
        showFileError("Pin a script to the context menu first.");
        return;
      }
      try {
        const file = await ReadScriptFile(pinnedScriptPath);
        if (!file) return;
        // Open the script so the run is visible, then run it.
        await onScriptSelect({ path: file.path, name: file.name });
        const kaja = kajaRef.current!;
        kaja.input = text;
        const run = beginRun(file.name, file.path);
        runTask(file.content, kaja, apps, onScriptError)
          .then(() => kaja.settleTables())
          .finally(() => setActiveRun((active) => (active?.runId === run.id ? { ...active, settled: true } : active)));
      } catch (err) {
        showFileError(`Run failed: ${err}`);
      }
    },
    [pinnedScriptPath, onScriptSelect, apps, showFileError, onScriptError, beginRun],
  );

  const runContextMenuScriptRef = useRef(runContextMenuScript);
  runContextMenuScriptRef.current = runContextMenuScript;

  // Wire the native macOS "Run Kaja Script" text service.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("service:runScript", (text: string) => runContextMenuScriptRef.current(text));
    return () => unsub();
  }, []);

  // Auto-save: open script views persist to disk on edit (debounced). No ⌘S, no
  // dirty indicator.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const disposables: monaco.IDisposable[] = [];
    for (const tab of views) {
      if (tab.type !== "script") continue;
      const { id, model } = tab;
      const path = tab.script.path;
      disposables.push(
        model.onDidChangeContent(() => {
          if (suppressScriptSave.current.has(id)) return;
          const existing = scriptSaveTimers.current.get(id);
          if (existing) clearTimeout(existing);
          scriptSaveTimers.current.set(
            id,
            setTimeout(() => {
              scriptSaveTimers.current.delete(id);
              WriteScriptFile(path, model.getValue()).catch((err) => showFileError(`Save failed: ${err}`));
            }, 500),
          );
        }),
      );
    }
    return () => disposables.forEach((d) => d.dispose());
  }, [views, showFileError]);

  // Script views are file-backed, so disk is their source of truth. The persisted
  // tab-state cache can go stale while the app is closed — an MCP write_script, an
  // external editor, or another window can change the file — so on mount re-read
  // each restored script tab from disk and reconcile its model. Without this a
  // reload would show the cached copy captured before the file last changed. The
  // beforeunload handler flushes pending saves, so disk is never behind the cache.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    let cancelled = false;
    (async () => {
      let reconciled = false;
      for (const tab of viewsRef.current) {
        if (tab.type !== "script") continue;
        try {
          const file = await ReadScriptFile(tab.script.path);
          if (cancelled || !file || tab.model.getValue() === file.content) continue;
          // Suppress the auto-save this edit would trigger — the content is disk's.
          suppressScriptSave.current.add(tab.id);
          tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: file.content }], () => null);
          suppressScriptSave.current.delete(tab.id);
          reconciled = true;
        } catch {
          // File missing or unreadable (e.g. deleted while closed); keep the
          // restored buffer rather than dropping the user's tab.
        }
      }
      if (!cancelled && reconciled) persistViews();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘S names a script and writes it to disk, which is what makes it a file.
  const onRequestSaveAsScript = useCallback(() => {
    if (!isWailsEnvironment()) return;
    const tab = viewsRef.current[0];
    if (!tab || (tab.type !== "scratch" && tab.type !== "script")) return;
    const defaultName = tab.type === "scratch" ? proposeFileName(viewIdentity(tab, scratchesRef.current).name) : tab.script.name.replace(/\.ts$/, "");
    setSaveAsError(undefined);
    setSaveAs({ name: defaultName, content: tab.model.getValue(), fromScratchId: tab.type === "scratch" ? tab.scratchId : undefined });
  }, []);

  const onSaveScratch = useCallback((scratch: Scratch) => {
    setSaveAsError(undefined);
    setSaveAs({ name: proposeFileName(scratch.title), content: scratch.code, fromScratchId: scratch.id });
  }, []);

  // "How do I dump everything I'm not keeping" — one click, and the confirm says
  // exactly what goes and what stays. Saved scripts are out of scope by
  // construction, so the destructive half can't reach a file.
  const onDiscardAllScratches = useCallback(() => {
    if (scratchesRef.current.length > 0) setBulkScratches({ verb: "discard", scratches: scratchesRef.current });
  }, []);

  const onSaveAllScratches = useCallback(() => {
    if (scratchesRef.current.length > 0) setBulkScratches({ verb: "save", scratches: scratchesRef.current });
  }, []);

  const onConfirmBulkScratches = useCallback(
    async (verb: "save" | "discard", list: Scratch[]) => {
      const ids = new Set(list.map((scratch) => scratch.id));
      if (verb === "discard") {
        applyViews((views) => views.filter((view) => !(view.type === "scratch" && ids.has(view.scratchId))));
        applyScratches((current) => current.filter((scratch) => !ids.has(scratch.id)));
        return;
      }
      // Bulk save names each file from its own title, disambiguating against
      // what is already on disk and against the ones written a moment ago.
      const names = proposeFileNames(
        list.map((scratch) => scratch.title),
        (scriptsRef.current ?? []).map((script) => script.name),
      );
      const written: Script[] = [];
      const saved = new Set<string>();
      for (const [index, scratch] of list.entries()) {
        try {
          const file = await CreateScript(names[index], scratch.code);
          if (!file) continue;
          written.push({ path: file.path, name: file.name });
          saved.add(scratch.id);
        } catch (err) {
          showFileError(`Save failed: ${err}`);
          break;
        }
      }
      if (written.length > 0) {
        setScripts((prev) => [...(prev ?? []), ...written].sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (saved.size > 0) {
        // Each scratch became its file, so it doesn't linger as a copy.
        applyViews((views) => views.filter((view) => !(view.type === "scratch" && saved.has(view.scratchId))));
        applyScratches((current) => current.filter((scratch) => !saved.has(scratch.id)));
      }
    },
    [applyScratches, applyViews, showFileError],
  );

  const onRequestSaveAsScriptRef = useRef(onRequestSaveAsScript);
  onRequestSaveAsScriptRef.current = onRequestSaveAsScript;

  // Wire the native File → Save menu item (⌘S).
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("menu:saveScript", () => onRequestSaveAsScriptRef.current());
    return () => unsub();
  }, []);

  // Start/stop the localhost MCP server in step with its feature preview, and
  // keep the connection details for the footer.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    if (!previewMcp) setMcpActive(false);
    MCPSetEnabled(previewMcp)
      .then((info) => setMcpInfo(info))
      .catch((err) => showFileError(`MCP server: ${err}`));
  }, [previewMcp, showFileError]);

  // The catalog follows the apps, not the compiler. Pushing it from the
  // compilation path meant a change that compiles nothing — deleting an app,
  // and above all deleting the last one — left the server answering from the
  // apps that were there before. The variables ride along for the same reason
  // the editor's declaration takes them: they are part of what a script is
  // written against.
  useEffect(() => {
    if (!isWailsEnvironment() || !previewMcp) return;
    const variableNames = Object.keys(configuration?.variables ?? {});
    MCPSetCatalog(JSON.stringify(buildMcpCatalog(apps, variableNames))).catch(() => {});
  }, [apps, previewMcp, configuration?.variables]);

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
  // console output, what it drew, and the RPCs it made back to the Go side.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("mcp:runScript", async (payload: { id: string; path: string; code: string }) => {
      const report = (result: McpRunReport) => MCPScriptResult(payload.id, JSON.stringify(result)).catch(() => {});

      let source = payload.code;
      if (payload.path) {
        try {
          const file = await ReadScriptFile(payload.path);
          source = file?.content ?? "";
        } catch (err) {
          report({ console: [], error: err instanceof Error ? err.message : String(err), methodCalls: [] });
          return;
        }
      }

      // A saved script runs in its own console under its own name. A snippet has
      // no file, so it is given one: exploration in Kaja is a scratch, and an
      // agent exploring is not a different kind of event from a person doing it.
      const scratch = payload.path ? undefined : agentScratchRef.current(source);
      const fileId = payload.path || scratch?.id;
      const collected: MethodCall[] = [];
      mcpRunCollectorRef.current = collected;
      const drawn = new Map<string, Block>();
      mcpBlockCollectorRef.current = drawn;
      let result: McpRunReport;
      const run = beginRunRef.current(payload.path ? payload.path.split("/").pop()! : (scratch?.title ?? "Agent script"), fileId, undefined, {
        origin: "agent",
      });
      try {
        const kaja = kajaRef.current!;
        kaja.input = undefined;
        const captured = await runTaskCaptured(source, kaja, appsRef.current);
        // An agent's table has nobody to page it, so its receipt is the first
        // page — which is exactly what it says it is.
        await kaja.settleTables();
        result = { ...captured, methodCalls: collected.map(toMethodCallLog), blocks: [...drawn.values()].map(toBlockLog) };
      } catch (err) {
        result = {
          console: [],
          error: err instanceof Error ? err.message : String(err),
          methodCalls: collected.map(toMethodCallLog),
          blocks: [...drawn.values()].map(toBlockLog),
        };
      } finally {
        mcpRunCollectorRef.current = null;
        mcpBlockCollectorRef.current = null;
        setActiveRun((active) => (active?.runId === run.id ? { ...active, settled: true } : active));
      }
      report(result);
    });
    return () => unsub();
  }, []);

  const onConfirmSaveAsScript = useCallback(async () => {
    if (!saveAs) return;
    const name = saveAs.name.trim();
    if (!name) {
      setSaveAsError("Enter a name.");
      return;
    }
    try {
      const file = await CreateScript(name, saveAs.content);
      if (!file) return;
      const script: Script = { path: file.path, name: file.name };
      setScripts((prev) => [...(prev ?? []), script].sort((a, b) => a.name.localeCompare(b.name)));
      applyViews((views) => {
        const shown = showScript(views, script, file.content);
        // The scratch became the file, so it doesn't linger as a copy.
        const source = saveAs.fromScratchId && shown.find((view) => view.type === "scratch" && view.scratchId === saveAs.fromScratchId);
        return source ? dropView(shown, source.id) : shown;
      });
      if (saveAs.fromScratchId) {
        const id = saveAs.fromScratchId;
        applyScratches((list) => list.filter((candidate) => candidate.id !== id));
        // Saving changes what the file is called, not what it is, so its runs
        // come along to the path it now lives at.
        setHistory((current) => renameFile(current, id, script.path));
        renameStoredFile(id, script.path);
      }
      setSaveAs(null);
      setSaveAsError(undefined);
    } catch (err) {
      setSaveAsError(String(err));
    }
  }, [saveAs, applyScratches, applyViews]);

  // Right-click → Rename: open a dialog prefilled with the current name.
  const onRenameScript = useCallback((script: Script) => {
    setRenameError(undefined);
    setRenameScript({ script, name: script.name.replace(/\.ts$/, "") });
  }, []);

  // Reflect a rename that already happened on disk: update the sidebar list,
  // re-point any open tab, and keep the context-menu pin on the renamed file.
  const applyScriptRename = useCallback(
    (oldPath: string, renamed: Script) => {
      setScripts((prev) => (prev ?? []).map((s) => (s.path === oldPath ? renamed : s)).sort((a, b) => a.name.localeCompare(b.name)));
      applyViews((views) => views.map((tab) => (tab.type === "script" && tab.script.path === oldPath ? { ...tab, script: renamed } : tab)));
      setPinnedScriptPath((current) => (current === oldPath ? renamed.path : current));
      // The file is the console's key, so a rename moves it rather than losing it.
      setHistory((current) => renameFile(current, oldPath, renamed.path));
      renameStoredFile(oldPath, renamed.path);
    },
    [applyViews],
  );

  const onConfirmRenameScript = useCallback(async () => {
    if (!renameScript) return;
    const name = renameScript.name.trim();
    if (!name) {
      setRenameError("Enter a name.");
      return;
    }
    const original = renameScript.script;
    try {
      // Flush any pending auto-save to the current path so the rename moves fresh content.
      const openTab = viewsRef.current.find((t) => t.type === "script" && t.script.path === original.path);
      if (openTab?.type === "script") {
        const timer = scriptSaveTimers.current.get(openTab.id);
        if (timer) {
          clearTimeout(timer);
          scriptSaveTimers.current.delete(openTab.id);
          await WriteScriptFile(original.path, openTab.model.getValue());
        }
      }
      const file = await RenameScript(original.path, name);
      if (!file) return;
      applyScriptRename(original.path, { path: file.path, name: file.name });
      setRenameScript(null);
      setRenameError(undefined);
    } catch (err) {
      setRenameError(String(err));
    }
  }, [renameScript, applyScriptRename]);

  // Reflect a deletion that already happened on disk: drop the script from the
  // sidebar list and the context-menu pin, and close its tab.
  const removeScriptFromUI = useCallback(
    (path: string) => {
      setScripts((prev) => (prev ?? []).filter((s) => s.path !== path));
      setPinnedScriptPath((current) => (current === path ? undefined : current));
      // The file is gone, so its console goes with it.
      setHistory((current) => dropFile(current, path));
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

  // Right-click → Delete: confirm, then remove the file and close its tab.
  const onConfirmDeleteScript = useCallback(
    async (script: Script) => {
      try {
        await DeleteScript(script.path);
      } catch (err) {
        showFileError(`Delete failed: ${err}`);
        return;
      }
      removeScriptFromUI(script.path);
    },
    [showFileError, removeScriptFromUI],
  );

  // Reflect script changes made through the MCP server: live-reload the content
  // of an open tab on write, and keep the sidebar list in step with
  // create/rename/delete — no manual refresh or tab switch needed.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("mcp:scriptsChanged", (payload: { action: string; path: string; name?: string; content?: string; oldPath?: string }) => {
      switch (payload.action) {
        case "write": {
          const tab = viewsRef.current.find((t) => t.type === "script" && t.script.path === payload.path);
          const content = payload.content ?? "";
          if (tab?.type === "script" && tab.model.getValue() !== content) {
            // The content just came from disk. Apply it as an edit (not setValue)
            // so undo history survives, and suppress the auto-save it would
            // otherwise trigger — writing it straight back would be redundant.
            suppressScriptSave.current.add(tab.id);
            tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: content }], () => null);
            suppressScriptSave.current.delete(tab.id);
            // Keep the persisted tab-state cache in step so a reload restores this
            // content, not the stale copy captured before the write.
            persistViews();
          }
          break;
        }
        case "create": {
          const script: Script = { path: payload.path, name: payload.name ?? "" };
          setScripts((prev) => (prev && !prev.some((s) => s.path === script.path) ? [...prev, script].sort((a, b) => a.name.localeCompare(b.name)) : prev));
          consumeAgentScratch(script, payload.content ?? "");
          break;
        }
        case "rename":
          if (payload.oldPath) {
            applyScriptRename(payload.oldPath, { path: payload.path, name: payload.name ?? "" });
          }
          break;
        case "delete":
          removeScriptFromUI(payload.path);
          break;
      }
    });
    return () => unsub();
  }, [applyScriptRename, removeScriptFromUI, persistViews, consumeAgentScratch]);

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

        const tab = viewsRef.current.find((candidate) => candidate.id === viewId);
        if (tab?.type !== "scratch") return;
        // A scratch has no save step, so its text is written back as it is
        // typed — debounced, because every keystroke would be a store write.
        const pending = scratchSaveTimers.current.get(tab.scratchId);
        if (pending) clearTimeout(pending);
        scratchSaveTimers.current.set(
          tab.scratchId,
          setTimeout(() => {
            scratchSaveTimers.current.delete(tab.scratchId);
            updateScratch(tab.scratchId, (scratch) => ({ ...scratch, code: tab.model.getValue(), updatedAt: Date.now() }));
          }, 400),
        );
      });
      editorInstance.onDidChangeModel(report);
    },
    [applyViews, updateScratch],
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
    const tab = viewsRef.current[0];
    if (tab?.type !== "appForm" && tab?.type !== "variables") return;
    if (tab.editMode === "json" && !viewJsonValidRef.current) return;
    applyViews((views) =>
      tab.type === "appForm"
        ? setAppFormEditMode(views, tab.id, tab.editMode === "json" ? "form" : "json")
        : setVariablesEditMode(views, tab.id, tab.editMode === "json" ? "table" : "json"),
    );
  }, [applyViews]);
  const toggleJsonViewRef = useRef(toggleJsonView);
  toggleJsonViewRef.current = toggleJsonView;
  // The file on screen is the one Run runs, so its errors are the ones the row
  // reports — on the trigger, and as Run's reason for being disabled.
  const syntaxErrors = useSyntaxErrors(currentView?.type === "scratch" || currentView?.type === "script" ? currentView.model : undefined);

  // Run the current file's editor contents. Triggered by Run in the command
  // row, by ⌘⏎ and by F5.
  const onRunCurrentTab = useCallback(() => {
    const tab = viewsRef.current[0];
    if (!tab || (tab.type !== "scratch" && tab.type !== "script")) {
      return;
    }
    const editor = editorRegistryRef.current.get(tab.id);
    if (!editor) {
      return;
    }
    const code = editor.getValue();
    const controller = new AbortController();
    // Run names reuse the derived script names, so the console and the sidebar
    // speak the same language.
    const title = tab.type === "script" ? tab.script.name : (deriveScratchTitle(code) ?? viewIdentity(tab, scratchesRef.current).name);
    beginRun(title, tab.type === "script" ? tab.script.path : tab.scratchId, controller);
    // A live table draws its first page itself, and those calls are the run's:
    // the script is not over until they have landed, or the run would report a
    // duration that stops before the work it started.
    runTask(code, kajaRef.current!, apps, onScriptError, controller.signal)
      .then(() => kajaRef.current!.settleTables())
      .finally(() => setActiveRun((run) => (run?.controller === controller ? { ...run, settled: true } : run)));
    // A run is the punctuation that settles a scratch: it is when the title is
    // re-read from the code, rather than jittering as you type.
    if (tab.type === "scratch") {
      updateScratch(tab.scratchId, (scratch) => markRun(scratch, code, Date.now()));
    }
  }, [apps, beginRun, onScriptError, updateScratch]);

  // A generated method-call script issues its call without awaiting it, so the
  // script's own promise settles well before the response lands. The run is over
  // once the script has settled and nothing it started is still in flight — and
  // that is when its wall duration is known and it is worth keeping for the next
  // time the file is opened.
  useEffect(() => {
    if (!activeRun?.settled) return;
    const file = fileConsole(historyRef.current, activeRun.fileId);
    if (hasCallsInFlight(file, activeRun.runId)) return;

    if (activeRun.fileId) {
      const now = Date.now();
      const next = settleRun(historyRef.current, activeRun.fileId, activeRun.runId, now - activeRun.startedAt, now);
      setHistory(next);
      const settled = fileConsole(next, activeRun.fileId);
      saveRuns(activeRun.fileId, settled.runs, settled.items, now);
    }
    if (currentRunRef.current?.id === activeRun.runId) currentRunRef.current = null;
    setActiveRun(null);
  }, [history, activeRun]);

  // Which file the console is reporting on. Everything below the editor is that
  // file's: its runs, where it was left pointing, and what it was showing.
  const currentFileId = currentView?.type === "script" ? currentView.script.path : currentView?.type === "scratch" ? currentView.scratchId : undefined;
  const currentConsole = fileConsole(history, currentFileId);

  // Reopening a script gives you its code and, if we still hold them, the runs
  // it last made. They are read once and sit underneath anything run since.
  useEffect(() => {
    if (!currentFileId || fileConsole(historyRef.current, currentFileId).loaded) return;
    const fileId = currentFileId;
    const stored = loadRuns(fileId);
    setHistory((current) => adoptStoredRuns(current, fileId, stored, Date.now()));
  }, [currentFileId]);

  // Stop aborts the calls the run has in flight; the script itself stops at the
  // call it was awaiting. A run parked on a question is awaiting an answer
  // rather than a call, so Stop has to end that too or the script never returns.
  const onStopActiveRun = useCallback(() => {
    for (const blockId of [...pendingAsksRef.current.keys()]) onCancelAsk(blockId);
    setActiveRun((run) => {
      run?.controller?.abort();
      return null;
    });
  }, [onCancelAsk]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F5" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
        event.preventDefault();
        onRunCurrentTab();
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

  // Picking a type in the New dialog opens the create form tab for that type. The
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
  // too: the Variables tab shows them as a warning with the apps that use them.
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

  // Saving the Variables tab writes the configuration, which names the
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
      refreshOpenScratchEditors();
    }
  };

  // With the sidebar open its own header holds the macOS traffic lights; collapsed,
  // the command row is what the window's left corner lands on, so it takes over
  // the inset.
  const commandRowInset = isDesktopMac && sidebarCollapsed ? TRAFFIC_LIGHTS_INSET : 12;

  const currentIsEditor = currentView?.type === "scratch" || currentView?.type === "script";
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
    ...viewIdentity(view, scratches),
    key: view.id,
    go: () => onGoToView(view.id),
  }));

  // Everywhere else you can go. Typing narrows across both, which is what makes
  // the finder the only surface that can search the calls.
  const elsewhere = useMemo<Destination[]>(() => {
    const shownScratches = new Set(views.filter((view) => view.type === "scratch").map((view) => view.scratchId));
    const shownScripts = new Set(views.filter((view) => view.type === "script").map((view) => view.script.path));
    const destinations: Destination[] = [];

    // Saved and unsaved sit in one run, in one vocabulary: they are all
    // scripts, and the icon is the whole difference.
    for (const script of scripts ?? []) {
      if (shownScripts.has(script.path)) continue;
      destinations.push({
        key: `script:${script.path}`,
        name: script.name,
        path: "Scripts",
        origin: "",
        icon: FileCode,
        go: () => void onScriptSelect(script),
      });
    }

    for (const scratch of scratches) {
      if (shownScratches.has(scratch.id)) continue;
      destinations.push({
        key: `scratch:${scratch.id}`,
        name: scratch.title,
        path: "Scripts",
        origin: scratch.originAppName ?? "",
        icon: PenLine,
        provisional: isUntouched(scratch),
        go: () => onScratchSelect(scratch),
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
      for (const service of app.services) {
        for (const method of service.methods) {
          destinations.push({
            key: `call:${app.configuration.name}/${service.name}/${method.name}`,
            name: method.name,
            path: `${app.configuration.name} / ${service.name}`,
            origin: app.configuration.name,
            icon: FileCode,
            go: () => void onMethodSelect(method, service, app),
          });
        }
      }
    }

    return destinations;
  }, [apps, scratches, scripts, views, onScratchSelect, onScriptSelect, onMethodSelect, onVariablesClick, onShowCompileLog]);

  // Which files have something in the air, so a run started on one script says
  // so while you are looking at another.
  const runningFiles = useMemo(() => runningFileIds(history), [history]);
  const agentFiles = useMemo(() => agentFileIds(history), [history]);
  const waitingFiles = useMemo(() => waitingFileIds(history), [history]);

  const onConsoleSelect = useCallback(
    (selection: RunSelection | null) => setHistory((current) => setSelection(current, currentFileId, selection, Date.now())),
    [currentFileId],
  );

  const onConsoleTabChange = useCallback((tab: ConsoleTab) => setHistory((current) => setTab(current, currentFileId, tab, Date.now())), [currentFileId]);

  const onConsoleViewChange = useCallback((view: ConsoleView) => setHistory((current) => setView(current, currentFileId, view, Date.now())), [currentFileId]);

  // What the empty state offers instead of an illustration: the last few things
  // you were in. On a first run there are none and the list is simply absent.
  const recentFiles = useMemo<RecentFile[]>(() => {
    const files: RecentFile[] = scratches.slice(0, 3).map((scratch) => ({
      key: scratch.id,
      name: scratch.title,
      icon: PenLine,
      updatedAt: scratch.updatedAt,
      saved: false,
      go: () => onScratchSelect(scratch),
    }));
    for (const script of scripts ?? []) {
      if (files.length >= 3) break;
      files.push({ key: script.path, name: script.name, icon: FileCode, saved: true, go: () => void onScriptSelect(script) });
    }
    return files;
  }, [scratches, scripts, onScratchSelect, onScriptSelect]);

  // The pair you reach for mid-edit, beside the name of what it acts on: a dot
  // that says this isn't on disk, Save, and a discard that closes the file with
  // it. All three collapse away once there is nothing unsaved, so the row is
  // just name + Run for a file that has one — which is also why the whole group
  // is absent on the web, where there is no Save and it could never collapse.
  const unsavedView = currentView?.type === "scratch" ? scratches.find((scratch) => scratch.id === currentView.scratchId) : undefined;
  const fileActions =
    unsavedView && isWailsEnvironment() ? (
      <div className="flex shrink-0 items-center gap-1">
        <span aria-hidden title="Not on disk" className="size-[5px] shrink-0 rounded-full bg-amber-500" />
        <button
          type="button"
          onClick={onRequestSaveAsScript}
          className="flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-foreground hover:bg-accent"
        >
          <SaveIcon size={12} />
          Save
          <span className="font-mono text-muted-foreground">{navigator.platform.startsWith("Mac") ? "⌘S" : "Ctrl+S"}</span>
        </button>
        <IconButton
          icon={X}
          aria-label={`Discard ${unsavedView.title}`}
          variant="ghost"
          size="sm"
          className="size-6 [&_svg]:size-[13px]"
          onClick={() => onDiscardScratch(unsavedView)}
        />
      </div>
    ) : undefined;

  // The filenames a bulk save would write, so the confirm lists what it does.
  const bulkNames = useMemo(
    () =>
      bulkScratches?.verb === "save"
        ? proposeFileNames(
            bulkScratches.scratches.map((scratch) => scratch.title),
            (scripts ?? []).map((script) => script.name),
          )
        : [],
    [bulkScratches, scripts],
  );

  // Stop aborts what the button is showing, so it tracks the active run rather
  // than the file's in-flight state — a run started elsewhere says so in the
  // sidebar instead.
  const running = currentFileId !== undefined && activeRun?.fileId === currentFileId;
  const action = currentIsEditor ? (
    <RunButton
      onRun={onRunCurrentTab}
      onStop={onStopActiveRun}
      running={running}
      startedAt={running ? activeRun?.startedAt : undefined}
      error={syntaxErrors.first}
    />
  ) : jsonView ? (
    <IconButton
      icon={Code}
      aria-label={jsonView.showing ? jsonView.back : "Edit as JSON (⌘J)"}
      variant="ghost"
      size="sm"
      className={cn("size-[26px]", jsonView.showing && "bg-accent text-foreground")}
      disabled={jsonView.showing && !viewJsonValid}
      onClick={toggleJsonView}
    />
  ) : undefined;

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
                scripts={scripts}
                canUpdateConfiguration={runtime.canUpdateConfiguration}
                onSelect={onMethodSelect}
                onScriptSelect={isWailsEnvironment() ? onScriptSelect : undefined}
                onRenameScript={isWailsEnvironment() ? onRenameScript : undefined}
                onDeleteScript={isWailsEnvironment() ? (script) => setDeleteScript(script) : undefined}
                onPinScript={isDesktopMac ? onPinScript : undefined}
                pinnedScriptPath={pinnedScriptPath}
                runningFileIds={runningFiles}
                agentFileIds={agentFiles}
                waitingFileIds={waitingFiles}
                scratches={scratches}
                currentScratchId={currentView?.type === "scratch" ? currentView.scratchId : undefined}
                onScratchSelect={onScratchSelect}
                onDeleteScratch={onDiscardScratch}
                onSaveScratch={isWailsEnvironment() ? onSaveScratch : undefined}
                onSaveAllScratches={isWailsEnvironment() ? onSaveAllScratches : undefined}
                onDiscardAllScratches={onDiscardAllScratches}
                onShowAllScratches={() => setFinder("first")}
                currentScriptPath={currentView?.type === "script" ? currentView.script.path : undefined}
                onShowCompileLog={onShowCompileLog}
                onRecompileApp={onRecompile}
                onNewAppClick={onNewAppClick}
                onVariablesClick={onVariablesClick}
                autoExpandApp={autoExpandApp}
                reserveTrafficLights={isDesktopMac}
                onEditApp={onEditApp}
                onDeleteApp={onDeleteApp}
              />
            </div>
          )}
          <Gutter orientation="vertical" onResize={onSidebarResize} hitAreaSize={sidebarCollapsed ? 12 : undefined} />
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
              onSearch={() => setFinder("first")}
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
              <NoFileBlankslate onOpenFinder={() => setFinder("first")} onNewScratch={onNewScratch} recent={recentFiles} />
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
                  {bodies.map((tab) => (
                    <div key={tab.id} style={{ display: tab.id === currentView?.id ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                      {tab.type === "compiler" && (
                        <Compiler
                          apps={apps}
                          configurationLoaded={configurationLoaded}
                          onNewAppClick={onNewAppClick}
                          canUpdateConfiguration={runtime.canUpdateConfiguration}
                          expandApp={compileLogExpandApp}
                        />
                      )}
                      {(tab.type === "scratch" || tab.type === "script") && (
                        <div className="relative flex min-h-0 flex-1 flex-col">
                          <Editor
                            model={tab.model}
                            onMount={(editor) => onEditorReady(tab.id, editor)}
                            onGoToDefinition={onGoToDefinition}
                            viewState={tab.viewState}
                          />
                        </div>
                      )}
                      {tab.type === "definition" && (
                        <Definition model={tab.model} onGoToDefinition={onGoToDefinition} startLineNumber={tab.startLineNumber} startColumn={tab.startColumn} />
                      )}
                      {tab.type === "appForm" && (
                        <AppForm
                          mode={tab.mode}
                          initialData={tab.initialData}
                          allApps={configuration?.apps ?? []}
                          variables={configuration?.variables ?? {}}
                          readOnly={!runtime.canUpdateConfiguration}
                          editMode={tab.editMode}
                          onSubmit={onAppFormSubmit}
                          onCancel={onAppFormCancel}
                          onJsonValidChange={setTabJsonValid}
                        />
                      )}
                      {tab.type === "variables" && (
                        <Variables
                          variables={configuration?.variables ?? {}}
                          status={variableStatus}
                          storeAvailable={runtime.variableStoreAvailable}
                          usage={variableUsage}
                          readOnly={!runtime.canUpdateConfiguration}
                          editMode={tab.editMode}
                          onEditModeChange={(editMode) => applyViews((views) => setVariablesEditMode(views, tab.id, editMode))}
                          onJsonValidChange={setTabJsonValid}
                          active={tab.id === currentView?.id}
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
                    <Gutter orientation={isHorizontalLayout ? "vertical" : "horizontal"} onResize={isHorizontalLayout ? onEditorWidthResize : onEditorResize} />
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
                        runs={currentConsole.runs}
                        items={currentConsole.items}
                        selection={currentConsole.selection}
                        tab={currentConsole.tab}
                        view={currentConsole.view}
                        onSelect={onConsoleSelect}
                        onTabChange={onConsoleTabChange}
                        onViewChange={onConsoleViewChange}
                        onAnswer={onAnswerAsk}
                        onCancelAsk={onCancelAsk}
                        tableViews={tableViews}
                        onTableView={onTableView}
                        onTablePull={onTablePull}
                        onClear={currentFileId ? () => onClearConsole(currentFileId) : undefined}
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
          mcpInfo={previewMcp ? mcpInfo : undefined}
          mcpActive={mcpActive}
          apps={apps}
          configurationLoaded={configurationLoaded}
          onShowCompileLog={onShowCompileLog}
          onRecompile={onRecompile}
        />
      </div>
      {saveAs && (
        <Dialog
          title="Save script"
          onClose={() => {
            setSaveAs(null);
            setSaveAsError(undefined);
          }}
          footerButtons={[
            { content: "Cancel", onClick: () => setSaveAs(null) },
            { content: "Save", variant: "default", onClick: onConfirmSaveAsScript },
          ]}
        >
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <div className="relative">
              {/* Saved rows read as filenames and unsaved ones as call names;
                  proposing the filename from the derived name is what keeps the
                  section from splitting into two conventions the icon was
                  supposed to carry alone. */}
              <Input
                autoFocus
                className="pr-9 font-mono"
                value={saveAs.name}
                onChange={(e) => setSaveAs((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmSaveAsScript();
                  }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">.ts</span>
            </div>
            {saveAsError && <FormControl.Validation variant="error">{saveAsError}</FormControl.Validation>}
            <FormControl.Caption>
              Proposed from the script's contents. Renaming here is the only rename there is — it writes the file to disk, where agents and other tools can see
              it.
            </FormControl.Caption>
          </FormControl>
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
      {newAppOpen && <NewAppDialog appsPreviewEnabled={previewApps} onClose={() => setNewAppOpen(false)} onSelect={onSelectAppType} />}
      {renameScript && (
        <Dialog
          title="Rename script"
          onClose={() => {
            setRenameScript(null);
            setRenameError(undefined);
          }}
          footerButtons={[
            { content: "Cancel", onClick: () => setRenameScript(null) },
            { content: "Rename", variant: "default", onClick: onConfirmRenameScript },
          ]}
        >
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <div className="relative">
              <Input
                autoFocus
                className="pr-9"
                value={renameScript.name}
                onChange={(e) => setRenameScript((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmRenameScript();
                  }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">.ts</span>
            </div>
            {renameError && <FormControl.Validation variant="error">{renameError}</FormControl.Validation>}
          </FormControl>
        </Dialog>
      )}
      {deleteScript && (
        <ConfirmationDialog
          title="Delete script?"
          confirmButtonContent="Delete"
          confirmButtonType="danger"
          onClose={(gesture) => {
            const script = deleteScript;
            setDeleteScript(null);
            if (gesture === "confirm" && script) onConfirmDeleteScript(script);
          }}
        >
          Permanently delete <strong>{deleteScript.name}</strong>?
        </ConfirmationDialog>
      )}
      {/* The bulk verbs name every script they are about to touch, and say that
          the saved ones are kept — which is the whole reason clearing the pile
          is safe to offer in one click. */}
      {bulkScratches && (
        <ConfirmationDialog
          title={
            bulkScratches.verb === "save"
              ? `Save ${bulkScratches.scratches.length} unsaved ${bulkScratches.scratches.length === 1 ? "script" : "scripts"}?`
              : // Nothing is on disk on the web, so there is no "unsaved" subset
                // to name — it is simply all of them.
                `Discard ${bulkScratches.scratches.length} ${isWailsEnvironment() ? "unsaved " : ""}${
                  bulkScratches.scratches.length === 1 ? "script" : "scripts"
                }?`
          }
          confirmButtonContent={bulkScratches.verb === "discard" ? "Discard" : "Save"}
          confirmButtonType={bulkScratches.verb === "discard" ? "danger" : "primary"}
          onClose={(gesture) => {
            const pending = bulkScratches;
            setBulkScratches(null);
            if (gesture === "confirm" && pending) void onConfirmBulkScratches(pending.verb, pending.scratches);
          }}
        >
          <span className="flex flex-col gap-1">
            {/* The history is unlimited, so the list scrolls rather than growing
                the dialog past the buttons. */}
            <span className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {bulkScratches.scratches.map((scratch, index) => (
                <span key={scratch.id} className="flex items-center gap-2">
                  {isWailsEnvironment() && <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-amber-500" />}
                  <span className="truncate font-mono text-xs">{bulkScratches.verb === "save" ? `${bulkNames[index]}.ts` : scratch.title}</span>
                </span>
              ))}
            </span>
            {(scripts?.length ?? 0) > 0 && bulkScratches.verb === "discard" && (
              <span className="mt-1 text-xs">
                {scripts!.length === 1 ? `${scripts![0].name} is saved and will be kept.` : `${scripts!.length} saved scripts will be kept.`}
              </span>
            )}
          </span>
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
          <span className="text-sm text-muted-foreground">
            Discarded <span className="text-foreground">{discarded.scratch.title}</span>
          </span>
          <button type="button" className="text-sm font-medium text-foreground hover:underline" onClick={onUndoDiscard}>
            Undo
          </button>
        </div>
      )}
    </>
  );
}

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
  };
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
