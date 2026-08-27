import { useMediaQuery } from "./useMediaQuery";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { Button } from "./components/button";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { Braces, Code, FileCode, Folder, PenLine, Plug, Save as SaveIcon, ScrollText, TriangleAlert, X } from "lucide-react";
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
import { ApprovalRejectedError, ApproveDecision, AskCancelledError, callDurationMs, Kaja, KajaHost, MethodCall } from "./kaja";
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
import { isWithinFolder, scriptsWithin } from "./scriptTree";
import { generateMethodEditorCode } from "./appLoader";
import { barrel } from "./appImports";
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

const UNDO_DISCARD_MS = 8000;

// Calls arrive in bursts of a few milliseconds; without a linger the indicator
// would come and go inside one frame.
const MCP_ACTIVITY_LINGER_MS = 2500;

// Read so start-up pruning can't drop a draft that is about to reopen.
function openDraftIds(): string[] {
  const persisted = getPersistedValue<PersistedViewState>("views");
  return (persisted?.views ?? []).flatMap((view) => {
    const id = persistedDraftId(view);
    return id === undefined ? [] : [id];
  });
}

// Also reads the legacy "scratches" key: drafts were called scratches before the rename.
function persistedDrafts(): Draft[] {
  return getPersistedValue<Draft[]>("drafts") ?? getPersistedValue<Draft[]>("scratches") ?? [];
}

// Vertical padding the editor reserves around the code (see Editor.tsx).
const EDITOR_PADDING = 32;
const MIN_EDITOR_HEIGHT = 120;
const MAX_EDITOR_HEIGHT_RATIO = 0.55;
const SIDE_BY_SIDE_MIN_WIDTH = 1600;

const subscribeConsoleFlags = (notify: () => void) => consoles.subscribeFlags(notify);
const consoleFlagsVersion = () => consoles.flagsVersion();

// Headers are excluded: they are forwarded per request, not a creation parameter.
function appNeedsRecompile(a: ConfigurationApp, b: ConfigurationApp): boolean {
  return appType(a) !== appType(b) || JSON.stringify(appParameters(a)) !== JSON.stringify(appParameters(b));
}

// Parameters are expanded when the app is opened, so a changed ${NAME} forces a recompile too.
function appReferencesChangedVariable(app: ConfigurationApp, previous: { [key: string]: string }, next: { [key: string]: string }): boolean {
  return Object.values(appParameters(app)).some((value) => variableReferences(value).some((name) => previous[name] !== next[name]));
}

function applyAppRename(app: AppModel, newConfig: ConfigurationApp): AppModel {
  const originalName = app.configuration.name;
  const remappedSources = remapSourcesToNewName(app.sources, originalName, newConfig.name);
  const remappedServices = app.services.map((service) => ({
    ...service,
    sourcePath: newConfig.name + service.sourcePath.slice(originalName.length),
  }));
  // Mutated in place so clients already holding the ref pick up the new values.
  updateAppRef(app.appRef, newConfig);
  return {
    ...app,
    configuration: newConfig,
    sources: remappedSources,
    services: remappedServices,
  };
}

/**
 * A run in flight and the `Kaja` its script runs against. Dropping this record
 * releases the run's approvals, sampled methods, bound clients and console
 * closures; only a live table the canvas can still page holds it past that.
 */
interface LiveRun {
  run: Run;
  kaja: Kaja;
  controller?: AbortController;
  // The script itself has returned. Its calls may still be landing.
  settled: boolean;
}

/**
 * Naming a draft: the two things a file has that a draft hasn't. Renaming a file is
 * not this sheet — a file already has both, so it is typed in the row it is in.
 */
interface NameSheet {
  title: string;
  name: string;
  folder: string;
  // The draft being named, and its code.
  content?: string;
  draftId?: string;
}

/**
 * What a failed file operation says. A rejection reaches here as an Error, as a
 * string from the Wails bridge, or as neither, and interpolating one straight
 * into a sentence prints `Error: …` inside it or, worse, `[object Object]`.
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function sortScripts(scripts: Script[]): Script[] {
  return [...scripts].sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

interface RunCollector {
  calls: MethodCall[];
  blocks: Map<string, Block>;
}

// writeSourceModel backs a generated module with a Monaco model, reporting whether
// anything moved. A model that appears after a script's own does not retroactively
// clear its "cannot find module", so the callers poke the open editors.
function writeSourceModel(path: string, content: string): boolean {
  const uri = monaco.Uri.parse("ts:/" + path);
  const existing = monaco.editor.getModel(uri);
  if (!existing) {
    monaco.editor.createModel(content, "typescript", uri);
    return true;
  }
  if (existing.getValue() !== content) {
    existing.setValue(content);
    return true;
  }
  return false;
}

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [runtime, setRuntime] = useState<Runtime>(Runtime.create());
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  const [variableStatus, setVariableStatus] = useState<VariableStatus[]>([]);
  // Reported by the Variables view. Nothing reads it since the tab strip went.
  const [variablesState, setVariablesState] = useState<VariablesState>({ dirty: false, canSave: false, save: async () => {} });
  const variablesStateRef = useRef(variablesState);
  variablesStateRef.current = variablesState;
  const [apps, setApps] = useState<AppModel[]>([]);
  // Read before the drafts themselves: start-up is when the sweep runs.
  const [sweepDrafts, setSweepDrafts] = usePersistedState("sweepDrafts", true);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    pruneDrafts(persistedDrafts(), Date.now(), new Set(openDraftIds()), getPersistedValue<boolean>("sweepDrafts") ?? true),
  );
  const [views, setViews] = useState<View[]>(() => restoreViews(getPersistedValue<PersistedViewState>("views"), persistedDrafts()));
  const [sidebarWidth, setSidebarWidth] = usePersistedState("sidebarWidth", 240);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("sidebarCollapsed", false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const [editorHeight, setEditorHeight] = usePersistedState("editorHeight", 400);
  // Until the gutter is dragged the editor pane is sized to its content; dragging
  // switches to the manual editorHeight for good.
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
  useSyncExternalStore(subscribeConsoleFlags, consoleFlagsVersion);
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
  const [scriptFolders, setScriptFolders] = useState<string[]>([]);
  const [previewApps, setPreviewApps] = usePersistedState("featurePreview:previewApps", false);
  const previewAppsRef = useRef(previewApps);
  previewAppsRef.current = previewApps;
  const [mcpInfo, setMcpInfo] = useState<main.MCPInfo | undefined>();
  const [mcpActive, setMcpActive] = useState(false);
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
  const [nameSheet, setNameSheet] = useState<NameSheet | null>(null);
  const [nameSheetError, setNameSheetError] = useState<string>();
  const [askPrompt, setAskPrompt] = useState<{
    question: AskBlock;
    value: string;
    problem?: string;
    resolve: (value: string) => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  const [approvePrompt, setApprovePrompt] = useState<{
    call: ApproveBlock;
    resolve: (decision: ApproveDecision) => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  const [newAppOpen, setNewAppOpen] = useState(false);
  // Gates switching back to the form or the table, so it lives beside the control that switches.
  const [viewJsonValid, setViewJsonValid] = useState(true);
  const viewJsonValidRef = useRef(viewJsonValid);
  viewJsonValidRef.current = viewJsonValid;
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // One-shot signal to expand an app's logs when the compile log is opened for it.
  const [compileLogExpandApp, setCompileLogExpandApp] = useState<{ name: string }>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null);
  const [clearAllPrompt, setClearAllPrompt] = useState<{ all: Draft[]; edited: Draft[] } | null>(null);
  // A `kaja://run/…` deeplink that arrived and is waiting to be let through.
  const [linkPrompt, setLinkPrompt] = useState<{ script: Script; input: { [key: string]: string } } | null>(null);
  // The deeplink a script is being copied from, and the parameters it takes.
  const [linkSheet, setLinkSheet] = useState<{ script: Script; parameters: string[] } | null>(null);
  const [presentRunId, setPresentRunId] = useState<string>();
  const [runPrompt, setRunPrompt] = useState<{ fileId: string; fileName: string; parameters: string[] } | null>(null);
  const [activeRuns, setActiveRuns] = useState<LiveRun[]>([]);
  const activeRunsRef = useRef(activeRuns);
  activeRunsRef.current = activeRuns;
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
    window.setTimeout(() => setFileError((current) => (current === message ? undefined : current)), 6000);
  }, []);

  const persistViews = useCallback(() => {
    setPersistedValue(
      "views",
      serializeViews(viewsRef.current, (viewId) => editorRegistryRef.current.get(viewId)?.saveViewState()),
    );
  }, []);

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

  // Flush a script view's pending debounced write (e.g. before its model is disposed).
  const flushScriptWrite = useCallback(
    (view: View) => {
      if (view.type !== "script" || !canWriteScripts()) return;
      const timer = scriptSaveTimers.current.get(view.id);
      if (!timer) return;
      clearTimeout(timer);
      scriptSaveTimers.current.delete(view.id);
      writeScriptFile(view.script, view.model.getValue()).catch((err) => showFileError(`Save failed: ${errorText(err)}`));
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
   * Answers to `kaja.ask*` and decisions on `kaja.approve(...)`, keyed by the block
   * they were drawn as. Each entry remembers its run, because Stop is about one run.
   */
  const pendingPromptsRef = useRef(new Map<string, { runId: string; resolve: (answer: string) => void; reject: (error: unknown) => void }>());

  const settlePrompt = useCallback((blockId: string, settle: (pending: { resolve: (answer: string) => void; reject: (error: unknown) => void }) => void) => {
    const pending = pendingPromptsRef.current.get(blockId);
    if (!pending) return;
    pendingPromptsRef.current.delete(blockId);
    settle(pending);
  }, []);

  const hostRef = useRef<KajaHost>(null);
  if (!hostRef.current) {
    hostRef.current = new KajaHost();
  }
  const host = hostRef.current;

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
          if (collect) {
            const i = collect.calls.findIndex((m) => m.id === methodCall.id);
            if (i > -1) collect.calls[i] = methodCall;
            else collect.calls.push(methodCall);
          }
          recordUse(methodUse(methodCall.appName, methodCall.service, methodCall.method));
          consoles.recordCall(run.fileId, run.id, methodCall, Date.now());
        },
        onLog: (level: LogLevel, message: string) => {
          logScriptLine(logFileLevel(level), message);
          consoles.recordPrinted(run.fileId, run.id, level, message, Date.now());
        },
        onPerfSchedule: (schedule) => consoles.recordPerfSchedule(run.fileId, run.id, schedule, Date.now()),
        // Blocks arrive more than once — a table paints row by row — so they are recorded
        // against their own id rather than appended.
        onBlockUpdate: (blockId: string, block: Block) => {
          collect?.blocks.set(blockId, block);
          consoles.recordBlock(run.fileId, run.id, blockId, block, Date.now());
        },
        onAsk: (question: AskBlock, blockId: string) =>
          new Promise<string>((resolve, reject) => {
            if (!run.fileId) {
              // A select opens on its first option: the dialog has one field and it has to hold something.
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

  const markSettled = useCallback((runId: string) => {
    setActiveRuns((runs) => runs.map((live) => (live.run.id === runId ? { ...live, settled: true } : live)));
  }, []);

  const markSettledRef = useRef(markSettled);
  markSettledRef.current = markSettled;

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

  const onDecideApproval = useCallback(
    (blockId: string, gesture: ApproveGesture) =>
      settlePrompt(blockId, (pending) => (gesture === "rejected" ? pending.reject(new ApprovalRejectedError()) : pending.resolve(gesture))),
    [settlePrompt],
  );

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

  const [tableViews, setTableViews] = useState<{ [blockId: string]: TableView }>({});

  const onTableView = useCallback((blockId: string, view: TableView) => {
    setTableViews((current) => ({ ...current, [blockId]: view }));
  }, []);

  /**
   * Fill a live table further. The host routes the block to the `Kaja` that drew it,
   * so the calls land in that run's log however long ago it ended.
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

  const onTableCells = useCallback(async (blockId: string, cells: CellRef[]) => {
    const found = consoles.findBlock(blockId);
    const table = found?.block;
    if (!found || table?.kind !== "table") return;

    const held = await hostRef.current!.pullCells(blockId, cells);
    if (!held) {
      consoles.recordBlock(found.fileId, found.run.id, blockId, { ...table, expired: true }, Date.now());
    }
  }, []);

  const onClearConsole = useCallback((fileId: string) => {
    consoles.clearFile(fileId, Date.now());
    dropStoredFile(fileId);
  }, []);

  // Kept in sync during render so the first drag picks up wherever the gutter
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

  const featurePreviews: FeaturePreview[] = [{ key: "previewApps", label: "Preview Apps", enabled: previewApps }];

  const onToggleFeaturePreview = useCallback((key: string) => {
    if (key === "previewApps") {
      setPreviewApps((enabled) => !enabled);
    }
  }, []);

  const isNarrow = useMediaQuery("(max-width: 767px)");
  const isDesktopMac = isWailsEnvironment() && navigator.platform.startsWith("Mac");
  const overflow = isNarrow ? "auto" : "hidden";
  const sidebarMinWidth = isNarrow ? 250 : 100;
  const mainMinWidth = isNarrow ? 300 : 0;

  const disposeMonacoModelsForApp = useCallback((appName: string) => {
    monaco.editor.getModels().forEach((model) => {
      if (model.uri.path.startsWith("/" + appName + "/") || model.uri.path === "/" + appName + ".ts") {
        model.dispose();
      }
    });
  }, []);

  const createMonacoModelsForApp = useCallback((app: AppModel) => {
    app.sources.forEach((source) => writeSourceModel(source.path, source.file.text));
    const module = barrel(app);
    writeSourceModel(module.path, module.content);
  }, []);

  const refreshOpenDraftEditors = useCallback(() => {
    viewsRef.current.forEach((view) => {
      if (view.type === "draft") {
        const value = view.model.getValue();
        view.model.setValue(value);
      }
    });
  }, []);

  // TypeScript caches "cannot find module" for service imports resolved before their
  // backing source models existed, and never clears it on its own. Poke the editors
  // with an identity edit — not setValue, which would lose undo history — and
  // suppress the auto-save it would otherwise trigger.
  const refreshOpenScriptEditors = useCallback(() => {
    viewsRef.current.forEach((view) => {
      if (view.type === "script") {
        // onDidChangeContent fires synchronously within pushEditOperations, so bracketing
        // the poke leaves the set empty afterwards.
        suppressScriptSave.current.add(view.id);
        view.model.pushEditOperations([], [{ range: view.model.getFullModelRange(), text: view.model.getValue() }], () => null);
        suppressScriptSave.current.delete(view.id);
      }
    });
  }, []);

  const syncAppsFromConfiguration = useCallback(
    (
      newConfiguration: Configuration,
      prevApps: AppModel[],
      previousVariables: { [key: string]: string },
    ): { updatedApps: AppModel[]; removedNames: Set<string>; renames: Map<string, string> } => {
      const updatedApps: AppModel[] = [];
      const newVariables = newConfiguration.variables ?? {};
      const newApps = newConfiguration.apps || [];
      const newConfigByName = new Map(newApps.map((a) => [a.name, a]));
      const prevByName = new Map(prevApps.map((p) => [p.configuration.name, p]));

      const orphans = prevApps.filter((p) => !newConfigByName.has(p.configuration.name));
      const newcomerConfigs = newApps.filter((a) => !prevByName.has(a.name));

      // An orphan and a newcomer with the same type+parameters are the same backing
      // service renamed, so the compiled app can be remapped instead of recompiled.
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

      for (const newConfig of newApps) {
        const existingApp = prevByName.get(newConfig.name);
        const renamedFrom = renameMap.get(newConfig.name);

        if (renamedFrom) {
          disposeMonacoModelsForApp(renamedFrom.configuration.name);
          const renamedApp = applyAppRename(renamedFrom, newConfig);
          createMonacoModelsForApp(renamedApp);
          updatedApps.push(renamedApp);
          continue;
        }

        if (!existingApp) {
          updatedApps.push(createPendingApp(newConfig));
          continue;
        }

        if (appNeedsRecompile(existingApp.configuration, newConfig) || appReferencesChangedVariable(newConfig, previousVariables, newVariables)) {
          disposeMonacoModelsForApp(existingApp.configuration.name);
          updatedApps.push(createPendingApp(newConfig));
        } else {
          updateAppRef(existingApp.appRef, newConfig);
          updatedApps.push({ ...existingApp, configuration: newConfig });
        }
      }

      const removedNames = new Set(orphans.map((p) => p.configuration.name));
      for (const orphan of orphans) {
        disposeMonacoModelsForApp(orphan.configuration.name);
      }

      const renames = new Map<string, string>();
      for (const [newName, oldApp] of renameMap) {
        renames.set(oldApp.configuration.name, newName);
      }

      return { updatedApps, removedNames, renames };
    },
    [disposeMonacoModelsForApp, createMonacoModelsForApp],
  );

  const applyConfiguration = useCallback(
    (newConfiguration: Configuration) => {
      const previousVariables = configurationRef.current?.variables ?? {};
      setConfiguration(newConfiguration);

      setApps((prevApps) => {
        const { updatedApps, renames } = syncAppsFromConfiguration(newConfiguration, prevApps, previousVariables);

        // Only a rename is followed: a draft isn't bound to an app, so deleting one
        // leaves the draft alone.
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

  useEffect(() => {
    if (configurationRef.current) {
      applyConfiguration(configurationRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewApps]);

  useEffect(() => {
    const variables = configuration?.variables ?? {};
    setVariables(variables);
    registerKajaModule(Object.keys(variables));
    if (!hostRef.current) return;
    // Desktop only: its UI runs inside the app's own process, so a resolved value is
    // one it already holds. On the web the configuration's own text is all there is.
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

  const handleConfigurationFileChange = useCallback(async () => {
    const client = getApiClient();
    const { response } = await client.getConfiguration({});
    setVariableStatus(response.variableStatus);
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
  }, [applyConfiguration]);

  useConfigurationChanges(handleConfigurationFileChange);

  useEffect(() => {
    setValueCompletionApps(apps);
  }, [apps]);

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme(colorMode));
    document.body.style.backgroundColor = surfaceColor(colorMode);
    // The class goes on <html> so Base UI portals (rendered into <body>) are themed too.
    document.documentElement.classList.toggle("dark", colorMode === "night");
  }, [colorMode]);

  // Read from the list, not the view: running or appending re-derives the title
  // without the view itself changing.
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

  const refreshScripts = useCallback(() => {
    listScriptFiles()
      .then((list) => setScripts(sortScripts(list)))
      .catch((err) => {
        console.error("Failed to list scripts", err);
        setScripts([]);
      });
    // A folder holding nothing has no file to be inferred from, so folders are listed of their own.
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarCollapsed((collapsed) => !collapsed);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setFinder("previous");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        onNewDraftRef.current();
        return;
      }
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
    // Registered per app that has compiled, not once all of them have: a single slow or
    // failing app used to keep scripts from resolving the ones that were ready.
    let sourceModelsChanged = false;
    updatedApps.forEach((app) => {
      if (!app.sources) return;
      app.sources.forEach((source) => {
        sourceModelsChanged = writeSourceModel(source.path, source.file.text) || sourceModelsChanged;
      });
      const module = barrel(app);
      sourceModelsChanged = writeSourceModel(module.path, module.content) || sourceModelsChanged;
    });

    // A source model appearing after a script's own model does not retroactively clear
    // its stale "cannot find module" error, so poke the open editors.
    if (sourceModelsChanged) {
      refreshOpenScriptEditors();
    }

    const allCompiled = updatedApps.every((p) => p.compilation.status === "success");
    if (allCompiled && updatedApps.length > 0 && updatedApps[0].services.length > 0) {
      if (updatedApps.length === 0) {
        return;
      }

      if (viewsRestoredRef.current) {
        viewsRestoredRef.current = false;
        refreshOpenDraftEditors();
        return;
      }

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

  const onMethodSelect = useCallback(
    async (method: Method, service: Service, app: AppModel, mode: "go" | "append" = "go") => {
      // Wrapped before it goes anywhere: the editor's format-on-open only fires when a
      // model is created, and a takeover writes into one that already exists.
      const code = await formatTypeScript(generateMethodEditorCode(app, service, method));
      const originAppName = app.configuration.name;
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

      // Decided before the takeover below, which would otherwise be what made the duplicate.
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

  const discardDrafts = useCallback(
    (list: Draft[], label: string) => {
      if (list.length === 0) return;
      const ids = new Set(list.map((draft) => draft.id));
      applyViews((views) => views.filter((view) => !(view.type === "draft" && ids.has(view.draftId))));
      applyDrafts((current) => current.filter((draft) => !ids.has(draft.id)));
      // The console is held alongside the draft so taking the discard back brings the runs too.
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

  const onNewDraft = useCallback(() => {
    const draft = createDraft("", undefined, Date.now());
    applyDrafts((list) => [draft, ...list]);
    applyViews((views) => showDraft(views, draft));
  }, [applyDrafts, applyViews]);
  const onNewDraftRef = useRef(onNewDraft);
  onNewDraftRef.current = onNewDraft;

  const agentDraftIdRef = useRef<string | undefined>(getPersistedValue<string>("agentDraftId") ?? getPersistedValue<string>("agentScratchId"));
  const agentDraft = useCallback(
    (code: string, client: string): Draft => {
      const now = Date.now();
      const held = draftsRef.current.find((draft) => draft.id === agentDraftIdRef.current);
      const draft = { ...markRun(held ?? createDraft(code, undefined, now), code, now), agentClient: client };
      agentDraftIdRef.current = draft.id;
      setPersistedValue("agentDraftId", draft.id);
      applyDrafts((list) => (held ? list.map((candidate) => (candidate.id === draft.id ? draft : candidate)) : [draft, ...list]));
      const view = viewsRef.current.find((candidate) => candidate.type === "draft" && candidate.draftId === draft.id);
      if (view?.type === "draft" && view.model.getValue() !== code) view.model.setValue(code);
      return draft;
    },
    [applyDrafts],
  );
  const agentDraftRef = useRef(agentDraft);
  agentDraftRef.current = agentDraft;

  // Only an exact copy is the same document: a script the agent wrote differently
  // from what it ran is a new one, and the buffer stays where it is.
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
   * Opening the agent's draft puts the editor in follow mode: the client rewrites the
   * buffer between runs. Take over copies it into a draft of your own.
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
      // A copy of the code and nothing of the attribution: it is yours from here.
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
        showFileError(`Open failed: ${errorText(err)}`);
      }
    },
    [applyViews, showFileError],
  );

  const onCopyScriptLink = useCallback(
    async (script: Script) => {
      try {
        const open = viewsRef.current.find((view) => view.type === "script" && view.script.path === script.path);
        const content = open?.type === "script" ? open.model.getValue() : (await readScriptFile(script))?.content;
        setLinkSheet({ script, parameters: content ? readInputKeys(content) : [] });
      } catch (err) {
        showFileError(`Copy deeplink failed: ${errorText(err)}`);
      }
    },
    [showFileError],
  );

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
      // And nothing may open over it: the first-method auto-open below lands after this
      // and would take the pane.
      hasViewMemory.current = true;
      setLinkPrompt({ script, input: parsed.link.input });
    },
    [onScriptSelect, showFileError],
  );

  const openScriptLinkRef = useRef(openScriptLink);
  openScriptLinkRef.current = openScriptLink;

  const onConfirmScriptLink = useCallback(
    async (script: Script, input: { [key: string]: string }) => {
      try {
        const file = await readScriptFile(script);
        if (!file) return;
        rememberRunInput(file.script.path, input);
        const { run, kaja } = beginRun(file.script.name, file.script.path, undefined, { input });
        setPresentRunId(run.id);
        runScript(file.content, kaja, apps, reportScriptError(run))
          .then(() => kaja.settleTables())
          .finally(() => markSettled(run.id));
      } catch (err) {
        showFileError(`Run failed: ${errorText(err)}`);
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

  // The link is the page load, or a change of fragment — both the same door. The
  // fragment is cleared once handed over; `replaceState` fires no `hashchange`, so
  // clearing can't come back around as a second arrival.
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

  // The desktop buffers a link that arrived before the UI was listening and flushes
  // on this signal; the web reads its own URL at the same moment.
  useEffect(() => {
    if (linksReadyRef.current || scripts === undefined) return;
    linksReadyRef.current = true;
    if (isWailsEnvironment()) EventsEmit("link:ready");
    else takeLinkFromLocation();
  }, [scripts, takeLinkFromLocation]);

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
              writeScriptFile(script, model.getValue()).catch((err) => showFileError(`Save failed: ${errorText(err)}`));
            }, 500),
          );
        }),
      );
    }
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [views, showFileError]);

  // Disk is a script view's source of truth, and the persisted view-state cache can
  // go stale while the app is closed (an MCP write, an external editor, another
  // window), so re-read each restored script view on mount.
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

  const lastFolderRef = useRef<string>(getPersistedValue<string>("lastScriptFolder") ?? "");
  const openNameSheet = useCallback((sheet: NameSheet) => {
    setNameSheetError(undefined);
    setNameSheet(sheet);
  }, []);

  const takenNames = useCallback((folder: string) => (scriptsRef.current ?? []).filter((script) => script.folder === folder).map((script) => script.name), []);

  const onRequestSave = useCallback(() => {
    if (!canWriteScripts()) return;
    const view = viewsRef.current[0];
    if (view?.type !== "draft") return;
    const draft = draftsRef.current.find((candidate) => candidate.id === view.draftId);
    openNameSheet({
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
        name: proposeFileName(draft.title, takenNames("")),
        folder: lastFolderRef.current,
        content: draft.code,
        draftId: draft.id,
        title: isAgentDraft(draft) ? `Name what ${draft.agentClient} wrote` : "Name this draft",
      }),
    [openNameSheet, takenNames],
  );

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

  useEffect(() => {
    if (!isWailsEnvironment()) return;
    MCPServerInfo()
      .then((info) => setMcpInfo(info))
      .catch((err) => showFileError(`MCP server: ${errorText(err)}`));
  }, [showFileError]);

  // The catalog follows the apps, not the compiler: a change that compiles nothing —
  // deleting an app, above all the last one — must still be reflected.
  useEffect(() => {
    const variableNames = Object.keys(configuration?.variables ?? {});
    const catalog = JSON.stringify(buildMcpCatalog(apps, variableNames));
    if (isWailsEnvironment()) {
      MCPSetCatalog(catalog).catch(() => {});
    } else {
      agentSession.setCatalog(catalog);
    }
  }, [apps, configuration?.variables]);

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

  const runForAgent = useCallback(async ({ path, code, client }: { path: string; code: string; client?: string }): Promise<McpRunReport> => {
    let source = code;
    // The desktop asks the window to read the file, because the window is in the
    // process that holds the disk; a server reads it itself and sends the source down.
    if (path && !source) {
      try {
        const known = (scriptsRef.current ?? []).find((script) => script.path === path);
        const file = known && (await readScriptFile(known));
        source = file ? file.content : "";
        if (!file) throw new Error(`No script at ${path}`);
      } catch (err) {
        return { console: [], error: errorText(err), methodCalls: [] };
      }
    }

    const draft = path ? undefined : agentDraftRef.current(source, client || "Agent");
    const fileId = path || draft?.id;
    const collect: RunCollector = { calls: [], blocks: new Map<string, Block>() };
    const report = () => ({ methodCalls: collect.calls.map(toMethodCallLog), blocks: [...collect.blocks.values()].map(toBlockLog) });
    let result: McpRunReport;
    const { run, kaja } = beginRunRef.current(path ? path.split("/").pop()! : (draft?.title ?? "Agent script"), fileId, undefined, {
      origin: "agent",
      collect,
    });
    try {
      const captured = await runScriptCaptured(source, kaja, appsRef.current);
      await kaja.settleTables();
      result = { ...captured, ...report() };
    } catch (err) {
      result = { console: [], error: errorText(err), ...report() };
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

  const applyScriptRename = useCallback(
    (oldPath: string, renamed: Script) => {
      setScripts((prev) => sortScripts((prev ?? []).map((script) => (script.path === oldPath ? renamed : script))));
      applyViews((views) => views.map((view) => (view.type === "script" && view.script.path === oldPath ? { ...view, script: renamed } : view)));
      consoles.renameFile(oldPath, renamed.path);
      renameStoredFile(oldPath, renamed.path);
      moveRunInput(oldPath, renamed.path);
    },
    [applyViews],
  );

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
      const script = await createScriptFile(name, folder, sheet.content ?? "");
      const content = sheet.content ?? "";
      setScripts((prev) => sortScripts([...(prev ?? []), script]));
      if (folder) setScriptFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder].sort()));
      applyViews((views) => {
        const shown = showScript(views, script, content);
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
        consoles.renameFile(id, script.path);
        renameStoredFile(id, script.path);
        moveRunInput(id, script.path);
      }
      lastFolderRef.current = folder;
      setPersistedValue("lastScriptFolder", folder);
      setNameSheet(null);
      setNameSheetError(undefined);
    } catch (err) {
      setNameSheetError(errorText(err));
    }
  }, [nameSheet, applyDrafts, applyViews]);

  /**
   * A file's path is its name, so renaming and moving are the same write and the name
   * typed in the row has already been resolved to the folder it lands in.
   */
  const onRenameScript = useCallback(
    async (script: Script, name: string, folder: string) => {
      try {
        // Flush the pending auto-save to the current path, so the rename moves what is in
        // the buffer rather than what disk caught up to.
        const open = viewsRef.current.find((view) => view.type === "script" && view.script.path === script.path);
        if (open) flushScriptWrite(open);
        applyScriptRename(script.path, await renameScriptFile(script, name, folder));
        if (folder) setScriptFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder].sort()));
      } catch (err) {
        showFileError(`Rename failed: ${errorText(err)}`);
      }
    },
    [applyScriptRename, flushScriptWrite, showFileError],
  );

  // Dropped on a folder row, so the destination is settled and there is nothing to type:
  // the file keeps its name and changes its place, which on disk is the one write a
  // rename is.
  const onMoveScript = useCallback(
    async (script: Script, folder: string) => {
      if (script.folder === folder) return;
      try {
        const open = viewsRef.current.find((view) => view.type === "script" && view.script.path === script.path);
        if (open) flushScriptWrite(open);
        applyScriptRename(script.path, await renameScriptFile(script, script.name, folder));
      } catch (err) {
        showFileError(`Move failed: ${errorText(err)}`);
      }
    },
    [applyScriptRename, flushScriptWrite, showFileError],
  );

  const removeScriptFromUI = useCallback(
    (path: string) => {
      setScripts((prev) => (prev ?? []).filter((s) => s.path !== path));
      consoles.dropFile(path);
      dropStoredFile(path);
      applyViews((views) => {
        const shown = views.find((candidate) => candidate.type === "script" && candidate.script.path === path);
        if (!shown) return views;
        // Cancel the pending auto-save so dropping the view can't recreate the file that
        // was just deleted.
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

  const onConfirmDeleteScript = useCallback(
    async (script: Script) => {
      try {
        await deleteScriptFile(script);
      } catch (err) {
        showFileError(`Delete failed: ${errorText(err)}`);
        return;
      }
      removeScriptFromUI(script.path);
    },
    [showFileError, removeScriptFromUI],
  );

  const onCreateFolder = useCallback(
    async (path: string) => {
      try {
        const created = await createScriptFolder(path);
        setScriptFolders((prev) => (prev.includes(created) ? prev : [...prev, created].sort()));
      } catch (err) {
        showFileError(`New folder failed: ${errorText(err)}`);
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
        for (const script of scriptsRef.current ?? []) {
          if (!isWithinFolder(path, script.folder)) continue;
          const folder = moved + script.folder.slice(path.length);
          applyScriptRename(script.path, {
            ...script,
            folder,
            path: script.path.slice(0, script.path.length - scriptName(script).length) + `${folder}/${script.name}`,
          });
        }
      } catch (err) {
        showFileError(`Rename failed: ${errorText(err)}`);
      }
    },
    [applyScriptRename, showFileError],
  );

  // A folder is a place, so deleting one deletes what is filed there — the files
  // and the folders under it alike. Disk first: nothing leaves the sidebar until
  // it is gone, so a refused delete leaves a list that still matches the disk.
  const onConfirmDeleteFolder = useCallback(
    async (path: string) => {
      const scripts = scriptsWithin(scriptsRef.current ?? [], path);
      try {
        await deleteScriptFolder(path);
      } catch (err) {
        showFileError(`Delete failed: ${errorText(err)}`);
        return;
      }
      setScriptFolders((prev) => prev.filter((folder) => !isWithinFolder(path, folder)));
      for (const script of scripts) removeScriptFromUI(script.path);
    },
    [showFileError, removeScriptFromUI],
  );

  const onRevealScripts = useCallback(() => {
    ScriptsFolder()
      .then((folder) => ShowFileInFinder(folder))
      .catch(() => {});
  }, []);

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
              // Apply as an edit rather than setValue so undo history survives, and record it as
              // saved — an agent's write is a save.
              suppressScriptSave.current.add(view.id);
              view.model.pushEditOperations([], [{ range: view.model.getFullModelRange(), text: content }], () => null);
              suppressScriptSave.current.delete(view.id);
              // Keep the persisted view-state cache in step so a reload restores this content.
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

  // Derived from the line count rather than Monaco's content height: with
  // scrollBeyondLastLine on, content height grows with the editor itself, so feeding
  // it back would only ever settle at the maximum.
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
        // Only a real edit writes back: the editor formats its model on open.
        if (!editorInstance.hasTextFocus()) return;

        const view = viewsRef.current.find((candidate) => candidate.id === viewId);
        if (view?.type !== "draft") return;
        // Debounced, because every keystroke would otherwise be a store write.
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
  const syntaxErrors = useSyntaxErrors(currentView?.type === "draft" || currentView?.type === "script" ? currentView.model : undefined);
  const inputKeys = useInputKeys(currentView?.type === "draft" || currentView?.type === "script" ? currentView.model : undefined);

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
      const title = view.type === "script" ? view.script.name : (deriveDraftTitle(code) ?? viewIdentity(view, draftsRef.current).name);
      const fileId = view.type === "script" ? view.script.path : view.draftId;
      if (input) rememberRunInput(fileId, input);
      const { run, kaja } = beginRun(title, fileId, controller, input ? { input } : undefined);
      // A live table draws its first page itself, and those calls are the run's.
      runScript(code, kaja, apps, reportScriptError(run), controller.signal)
        .then(() => kaja.settleTables())
        .finally(() => markSettled(run.id));
      if (view.type === "draft") {
        updateDraft(view.draftId, (draft) => markRun(draft, code, Date.now()));
      }
    },
    [apps, beginRun, reportScriptError, updateDraft, markSettled],
  );

  /**
   * A run is over. Settling it and dropping the record are one act: the live list is
   * where the settle check looks, so a record taken off it without a duration is a run
   * nothing can settle — and one without a duration reads as still running.
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

  // A generated method-call script issues its call without awaiting it, so the
  // script's promise settles well before the response lands. It hangs off the store
  // rather than off a render, or the question would be asked again for every call.
  const settleIfQuiet = useCallback(() => {
    // Every run in flight is asked: they finish in whatever order their work does.
    const done = activeRunsRef.current.filter((live) => live.settled && !consoles.hasWorkInFlight(live.run.fileId, live.run.id));
    endRuns(done, Date.now());
  }, [endRuns]);

  useEffect(() => consoles.subscribeQuiet(settleIfQuiet), [settleIfQuiet]);
  useEffect(settleIfQuiet, [activeRuns, settleIfQuiet]);

  const currentFileId = currentView?.type === "script" ? currentView.script.path : currentView?.type === "draft" ? currentView.draftId : undefined;

  useEffect(() => {
    if (!currentFileId || consoles.file(currentFileId).loaded) return;
    consoles.adoptStoredRuns(currentFileId, loadRuns(currentFileId), Date.now());
  }, [currentFileId]);

  /**
   * Stop aborts this file's runs and the questions they are parked on, and ends the
   * run itself rather than waiting for the script to unwind — a run parked on a
   * question that will never be asked again has nothing left to settle it.
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

  const onCopyCurrentLink = useMemo(() => {
    if (currentView?.type !== "script") return undefined;
    const script = currentView.script;
    return () => setLinkSheet({ script, parameters: inputKeys });
  }, [currentView, inputKeys]);
  const onCopyCurrentLinkRef = useRef(onCopyCurrentLink);
  onCopyCurrentLinkRef.current = onCopyCurrentLink;

  // `ShowFileInFinder` selects the file and falls back to the nearest folder that
  // exists, so a script written but not yet flushed still lands somewhere useful.
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
   * The copy of a read-only file, in the one place it can be edited. Taken from the
   * buffer, on the rule Run follows. Absent on the desktop, where a file is writable.
   */
  const onDuplicateAsDraft = useCallback(() => {
    const view = viewsRef.current[0];
    if (view?.type !== "script") return;
    const code = editorRegistryRef.current.get(view.id)?.getValue() ?? "";
    const now = Date.now();
    // An empty `generatedCode` is what keeps the next method click from taking this
    // over and the sweep from dropping it.
    const draft = { ...createDraft(code, undefined, now), generatedCode: "" };
    applyDrafts((list) => [draft, ...list]);
    applyViews((views) => showDraft(views, draft));
  }, [applyDrafts, applyViews]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A sheet on top of the editor answers ⏎ itself.
      if (event.defaultPrevented) return;
      if (event.key === "F5" || ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === "Enter")) {
        event.preventDefault();
        onRunCurrentTab();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        onRunWithParametersRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "c" || event.key === "C")) {
        const copy = onCopyCurrentLinkRef.current;
        // Otherwise this is the browser's own Copy and stays it.
        if (!copy) return;
        event.preventDefault();
        copy();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRunCurrentTab]);

  useEffect(() => {
    if (!configurationLoaded || apps.length > 0) return;
    applyViews((views) => {
      const compiler = views.find((view) => view.type === "compiler");
      return compiler ? dropView(views, compiler.id) : views;
    });
  }, [apps.length, configurationLoaded, applyViews]);

  const onShowCompileLog = useCallback(
    (appName?: string) => {
      setCompileLogExpandApp(appName ? { name: appName } : undefined);
      applyViews(showCompiler);
    },
    [applyViews],
  );

  // An app already compiling is left to finish.
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

    const updatedConfiguration: Configuration = {
      ...configuration,
      apps: isEdit ? (configuration.apps || []).map((a) => (a.name === originalName ? app : a)) : [...(configuration.apps || []), app],
    };

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

  // What deleting the folder on the confirmation would take with it.
  const deleteFolderFiles = useMemo(() => (deleteFolder ? scriptsWithin(scripts ?? [], deleteFolder) : []), [deleteFolder, scripts]);

  // Names no variable defines are in here too: the Variables view shows them as a warning.
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

  // Values going the other way don't come through here: they are written the moment
  // they are entered.
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

  // Machine state, not file state, so it is written when entered rather than on save.
  const onStoreVariableValue = async (name: string, value: string) => {
    const { response } = await getApiClient().setStoredValue({ name, value });
    setVariableStatus(response.variableStatus);
  };

  const onDeleteApp = async (appName: string) => {
    if (!configuration) {
      return;
    }

    const updatedConfiguration: Configuration = {
      ...configuration,
      apps: (configuration.apps || []).filter((a) => a.name !== appName),
    };

    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      applyConfiguration(response.configuration);
      refreshOpenDraftEditors();
    }
  };

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

  const recent: Destination[] = views.map((view) => ({
    ...viewIdentity(view, drafts),
    key: view.id,
    go: () => onGoToView(view.id),
  }));

  const elsewhere = useMemo<Destination[]>(() => {
    const shownDrafts = new Set(views.filter((view) => view.type === "draft").map((view) => view.draftId));
    const shownScripts = new Set(views.filter((view) => view.type === "script").map((view) => view.script.path));
    const destinations: Destination[] = [];

    for (const script of scripts ?? []) {
      if (shownScripts.has(script.path)) continue;
      destinations.push({
        key: `script:${script.path}`,
        name: script.name,
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

    // Before the calls: there are two of these and hundreds of calls.
    if (!views.some((view) => view.type === "variables")) {
      destinations.push({ key: "variables", name: "Variables", path: "Workspace", origin: "", icon: Braces, go: onVariablesClick });
    }
    if (apps.length > 0 && !views.some((view) => view.type === "compiler")) {
      destinations.push({ key: "compiler", name: "Compile log", path: "Output", origin: "", icon: ScrollText, go: () => onShowCompileLog() });
    }

    for (const app of apps) {
      const packages = hasMultiplePackages(app.services);
      for (const service of app.services) {
        const qualified = packages ? `${service.packageName}.${service.name}` : service.name;
        for (const method of service.methods) {
          destinations.push({
            // The package is part of the key: without it two same-named services in one app
            // share one, and React renders whichever it already had wherever the other belongs.
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

  const { running: runningFiles, agent: agentFiles, waiting: waitingFiles } = consoles.flagSets();

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

  // The counter reads from the oldest run here, so pressing Run again while one is
  // going extends the count rather than restarting it.
  const runsHere = currentFileId === undefined ? [] : activeRuns.filter((live) => live.run.fileId === currentFileId);
  const running = runsHere.length > 0;
  const runningSince = running ? Math.min(...runsHere.map((live) => live.run.startedAt)) : undefined;
  const runButton = currentIsEditor ? (
    <RunButton
      onRun={() => onRunCurrentTab()}
      onStop={onStopActiveRun}
      running={running}
      startedAt={runningSince}
      error={syntaxErrors.first}
      onRunWithParameters={inputKeys.length > 0 ? onRunWithParameters : undefined}
      onCopyDeeplink={onCopyCurrentLink}
      onRevealInFinder={onRevealCurrentScript}
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

  // Bodies render in creation order, so bringing a file to the front never moves a
  // live editor in the DOM.
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
                    onMoveScript={canWriteScripts() ? (script, folder) => void onMoveScript(script, folder) : undefined}
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
          two things a file has that a draft doesn't: a name and a folder.
          Renaming a file is not this sheet — a file has both already, so its
          name is typed in the row it is in. */}
      {nameSheet && (
        <Dialog
          title={nameSheet.title}
          onClose={() => {
            setNameSheet(null);
            setNameSheetError(undefined);
          }}
          footerButtons={[
            { content: "Cancel", onClick: () => setNameSheet(null) },
            { content: "Save", variant: "default", onClick: onConfirmNameSheet },
          ]}
        >
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <div className="relative">
              {/* A draft reads as a call name and a file as a filename;
                  proposing the filename from the derived name is what keeps the
                  section from splitting into two conventions. */}
              <Input
                autoFocus
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
        // Dismissing the dialog is not approving.
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
        <ParameterSheet
          // A second deeplink arriving while this one is on screen is a different question,
          // so it gets a different sheet rather than the first one's fields.
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
      {/* A folder is a place, so deleting one deletes the files filed there. The
          dialog is where that is said, and it names what it costs rather than
          refusing the folders that cost anything. */}
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
          Permanently delete <strong>{deleteFolder}</strong>
          {deleteFolderFiles.length > 0
            ? ` and the ${deleteFolderFiles.length === 1 ? "file" : `${deleteFolderFiles.length} files`} in it?`
            : "? Anything filed there goes with it."}
          {deleteFolderFiles.length > 0 && (
            <div className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2">
              {deleteFolderFiles.map((script) => {
                // A file deeper down is named by where it sits, so two `january.ts`
                // in different subfolders are two different lines.
                const under = script.folder.slice(deleteFolder.length + 1);
                return (
                  <span key={script.path} className="truncate text-sm text-foreground">
                    {under && <span className="text-muted-foreground">{under}/</span>}
                    <FileName name={script.name} />
                  </span>
                );
              })}
            </div>
          )}
        </ConfirmationDialog>
      )}
      {/* A floating surface, so it is opaque: at 10% the destructive tint let the
          console header read straight through the message it was covering. */}
      {fileError && (
        <div
          role="alert"
          className="fixed left-1/2 top-12 z-[1000] flex max-w-[640px] -translate-x-1/2 items-start gap-2 rounded-md border border-destructive/40 bg-popover px-3 py-2 shadow-lg"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-destructive" />
          <span className="min-w-0 break-words text-sm text-destructive">{fileError}</span>
          <IconButton icon={X} aria-label="Dismiss" size="xs" variant="ghost" onClick={() => setFileError(undefined)} />
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

function FolderField({ value, folders, onChange, onSubmit }: { value: string; folders: string[]; onChange: (folder: string) => void; onSubmit: () => void }) {
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
          <SelectTrigger>
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

function untouchedSentence(count: number): string {
  if (count === 0) return "None of them regenerate on demand.";
  return `${count} ${count === 1 ? "is" : "are"} untouched and regenerate${count === 1 ? "s" : ""} on demand.`;
}

// A value no folder can have, so picking it can't collide with one.
const NEW_FOLDER = "\u0000new";

// `result` is a value the script returned, which a script is not supposed to do —
// carried so the report can correct it rather than swallow it.
interface McpRunReport {
  console: string[];
  result?: unknown;
  error?: string;
  methodCalls: unknown[];
  blocks?: unknown[];
}

function toBlockLog(block: Block) {
  const table = block.kind === "table" ? block : undefined;
  return {
    kind: block.kind,
    label: blockLabel(block),
    columns: table?.columns,
    rows: table?.rows.length,
    // An agent has nobody to press Next, so it is told the rows are a page rather
    // than the set.
    more: table?.live === true && table.exhausted !== true ? true : undefined,
    // A cell that is a function is fetched when its row is drawn, and past the first
    // page nobody drew this one.
    ...countCells(table),
  };
}

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

function toMethodCallLog(call: MethodCall) {
  return {
    app: call.appName,
    service: call.service.name,
    method: call.method.name,
    // The API's time when Kaja measured it — what an agent reasoning about
    // latency wants — the round trip when nothing did.
    durationMs: callDurationMs(call),
    input: call.input,
    output: call.output,
    failure: call.error === undefined ? undefined : classifyFailure(call.error),
  };
}
