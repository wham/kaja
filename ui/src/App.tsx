import { useMediaQuery } from "./useMediaQuery";
import { Alert } from "./components/alert";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { Braces, Code, FileCode, PenLine, ScrollText } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { CommandRow } from "./CommandRow";
import { Console, ConsoleItem } from "./Console";
import { NoFileBlankslate } from "./NoFileBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { FileSwitcher, OpenSwitcherFile, SwitcherFile } from "./FileSwitcher";
import { Gutter } from "./Gutter";
import { AskCancelledError, isCallInFlight, Kaja, MethodCall } from "./kaja";
import { appHeaders, appParameters, appType, buildApp } from "./appTypes";
import { createPendingApp, getDefaultMethod, Method, App as AppModel, Script, Service, updateAppRef } from "./apps";
import { appendCall, createScratch, isUntouched, markRun, pruneScratches, renameScratch, Scratch, ScratchOrigin, takeOver, withCode } from "./scratches";
import { generateMethodEditorCode } from "./appLoader";
import { RunButton, useSyntaxErrors } from "./RunButton";
import { Sidebar, TRAFFIC_LIGHTS_INSET } from "./Sidebar";
import { NewAppDialog } from "./NewAppDialog";
import { StatusBar, ColorMode } from "./StatusBar";
import { FeaturePreview } from "./FeaturePreviews";
import { AppForm } from "./AppForm";
import { Editor, registerKajaModule, setValueCompletionApps } from "./Editor";
import { monacoTheme, surfaceColor } from "./monacoTheme";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { Configuration, ConfigurationApp, LogLevel, Runtime, VariableStatus } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  activateTab,
  closeTab,
  keepTab,
  openAppFormTab,
  openCompilerTab,
  openDefinitionTab,
  openScratchTab,
  openScriptTab,
  openVariablesTab,
  PersistedTabState,
  restoreTabs,
  serializeTabs,
  setAppFormEditMode,
  setVariablesEditMode,
  tabIdentity,
  TabModel,
} from "./tabModel";
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

// Maximum number of console items kept in memory; older calls are dropped.
const MAX_CONSOLE_ITEMS = 500;

// Scratch ids the last session had open, so start-up pruning can't drop one
// that is about to reopen.
function openScratchIds(): string[] {
  const persisted = getPersistedValue<PersistedTabState>("tabs");
  return (persisted?.tabs ?? []).flatMap((tab) => ("scratchId" in tab ? [tab.scratchId] : []));
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

// Lowercase the first letter (e.g. method name "GetUser" -> "getUser").
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

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
  // What a close gesture on the Variables tab is waiting on, while it asks
  // whether to save the edits, discard them, or stay.
  const [closingVariablesId, setClosingVariablesId] = useState<string>();
  const [apps, setApps] = useState<AppModel[]>([]);
  // Every scratch ever made, newest activity first — unlimited, kept in the
  // app, named from its own code. Independent of what is open: closing a tab
  // puts a scratch away, it doesn't throw it out.
  const [scratches, setScratches] = useState<Scratch[]>(() =>
    pruneScratches(getPersistedValue<Scratch[]>("scratches") ?? [], Date.now(), new Set(openScratchIds())),
  );
  // The open files, most-recently-visited first: tabs[0] is what the window is
  // showing. Nothing else records which file is current.
  const [tabs, setTabs] = useState<TabModel[]>(() =>
    restoreTabs(getPersistedValue<PersistedTabState>("tabs"), getPersistedValue<Scratch[]>("scratches") ?? []),
  );
  const [sidebarWidth, setSidebarWidth] = usePersistedState("sidebarWidth", 300);
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
  const [editorContentHeights, setEditorContentHeights] = useState<{ [tabId: string]: number }>({});
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight);
  const [editorWidth, setEditorWidth] = usePersistedState("editorWidth", 600);
  const [editorLayout, setEditorLayout] = usePersistedState<"vertical" | "horizontal">("editorLayout", () =>
    window.innerWidth >= SIDE_BY_SIDE_MIN_WIDTH ? "horizontal" : "vertical",
  );
  const [colorMode, setColorMode] = usePersistedState<ColorMode>("colorMode", "night");
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  // Whether the file switcher is open, and where it opened: ⌘P lands on the
  // previous file so ⌘P⏎ goes back, everything else on the first row.
  const [switcher, setSwitcher] = useState<"first" | "previous">();
  const [scrollToMethod, setScrollToMethod] = useState<{ method: Method; service: Service; app: AppModel }>();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const scratchesRef = useRef(scratches);
  scratchesRef.current = scratches;
  const editorRegistryRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());
  const hasTabMemory = useRef(getPersistedValue<PersistedTabState>("tabs") !== undefined);
  const tabsRestoredRef = useRef(tabs.some((tab) => tab.type === "scratch"));
  const [scripts, setScripts] = useState<Script[]>();
  // Experimental "Scripts" feature, toggled from the feature previews menu in the footer.
  const [previewScripts, setPreviewScripts] = usePersistedState("featurePreview:scripts", false);
  const previewScriptsRef = useRef(previewScripts);
  previewScriptsRef.current = previewScripts;
  // "Preview Apps" toggle: reveals the experimental built-in app types in the New
  // dialog (openapi/openai/markdown). gRPC/Twirp are always available.
  const [previewApps, setPreviewApps] = usePersistedState("featurePreview:previewApps", false);
  const previewAppsRef = useRef(previewApps);
  previewAppsRef.current = previewApps;
  // Experimental "MCP server" feature (desktop only): exposes script edit/run and
  // the service catalog to an agent over a localhost MCP endpoint.
  const [previewMcp, setPreviewMcp] = usePersistedState("featurePreview:mcp", false);
  const previewMcpRef = useRef(previewMcp);
  previewMcpRef.current = previewMcp;
  const [mcpInfo, setMcpInfo] = useState<main.MCPInfo | undefined>();
  // While an MCP run_script call is in flight, the method calls it makes are
  // collected here so they can be returned to the agent.
  const mcpRunCollectorRef = useRef<MethodCall[] | null>(null);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const [fileError, setFileError] = useState<string | undefined>();
  // Save-as dialog state for ⌘S; null when closed.
  // Saving is what turns a scratch into a file. The scratch it came from goes
  // away with it — the same buffer, now on disk.
  const [saveAs, setSaveAs] = useState<{ name: string; content: string; fromScratchId?: string } | null>(null);
  const [saveAsError, setSaveAsError] = useState<string>();
  // Active `kaja.ask(...)` prompt; null when no script is waiting for input.
  const [askPrompt, setAskPrompt] = useState<{
    message: string;
    value: string;
    resolve: (value: string) => void;
    reject: (reason: unknown) => void;
  } | null>(null);
  // Whether the New app dialog is open.
  const [newAppOpen, setNewAppOpen] = useState(false);
  // Whether the active tab's JSON parses. It gates switching back to the form or
  // the table, which is why it lives out here with the control that does the
  // switch.
  const [tabJsonValid, setTabJsonValid] = useState(true);
  const tabJsonValidRef = useRef(tabJsonValid);
  tabJsonValidRef.current = tabJsonValid;
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // One-shot signal to expand an app's logs when the compile log is opened for it.
  const [compileLogExpandApp, setCompileLogExpandApp] = useState<{ name: string }>();
  // Rename dialog and delete confirmation for scripts (right-click menu).
  const [renameScript, setRenameScript] = useState<{ script: Script; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  // Renaming a scratch is the one naming step there is: it pins the title, so
  // the code stops deciding it.
  const [renameScratchTarget, setRenameScratchTarget] = useState<{ scratch: Scratch; title: string } | null>(null);
  // Path of the script pinned to the macOS "Run Kaja Script" text service.
  const [pinnedScriptPath, setPinnedScriptPath] = useState<string | undefined>(() => getPersistedValue<string>("contextMenuScriptPath"));
  // The run in flight, if any: which tab issued it, when it started, and the
  // controller its Stop button aborts. `settled` marks the script itself as
  // finished — the run is only over once its calls have landed too.
  const [activeRun, setActiveRun] = useState<{ tabId: string; startedAt: number; controller: AbortController; settled: boolean } | null>(null);
  // Pending debounced disk writes for open script tabs, keyed by tab id.
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
    (tab: TabModel) => {
      if (tab.type !== "script") return;
      const timer = scriptSaveTimers.current.get(tab.id);
      if (!timer) return;
      clearTimeout(timer);
      scriptSaveTimers.current.delete(tab.id);
      WriteScriptFile(tab.script.path, tab.model.getValue()).catch((err) => showFileError(`Save failed: ${err}`));
    },
    [showFileError],
  );

  const persistTabs = useCallback(() => {
    setPersistedValue(
      "tabs",
      serializeTabs(tabsRef.current, (tabId) => editorRegistryRef.current.get(tabId)?.saveViewState()),
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

  const disposeTab = useCallback(
    (tab: TabModel) => {
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
  const applyTabs = useCallback(
    (update: (tabs: TabModel[]) => TabModel[]) => {
      const previous = tabsRef.current;
      const current = previous[0];
      if (current?.type === "scratch" || current?.type === "script") {
        const editor = editorRegistryRef.current.get(current.id);
        if (editor) current.viewState = editor.saveViewState() ?? undefined;
      }

      const next = update(previous);
      if (next === previous) return;

      const kept = new Set(next.map((tab) => tab.id));
      for (const tab of previous) {
        if (!kept.has(tab.id)) disposeTab(tab);
      }

      tabsRef.current = next;
      setTabs(next);
      persistTabs();
    },
    [disposeTab, persistTabs],
  );

  const onMethodCallUpdate = useCallback((methodCall: MethodCall) => {
    const collector = mcpRunCollectorRef.current;
    if (collector) {
      const i = collector.findIndex((m) => m.id === methodCall.id);
      if (i > -1) collector[i] = methodCall;
      else collector.push(methodCall);
    }
    setConsoleItems((consoleItems) => {
      const index = consoleItems.findIndex((item) => "id" in item && item.id === methodCall.id);
      if (index > -1) {
        return consoleItems.map((item, i) => (i === index ? { ...methodCall } : item));
      }
      const next = [...consoleItems, { ...methodCall }];
      // Cap history so a long session can't grow the console unbounded.
      return next.length > MAX_CONSOLE_ITEMS ? next.slice(next.length - MAX_CONSOLE_ITEMS) : next;
    });
  }, []);

  // Show a failed script run in the console; a script that dies silently looks
  // like it succeeded. Mirrored to console.error so it also lands in kaja.log.
  const onScriptError = useCallback((error: unknown) => {
    console.error("Script error:", error);
    const message = error instanceof Error ? (error.name === "Error" ? error.message : `${error.name}: ${error.message}`) : String(error);
    setConsoleItems((consoleItems) => {
      const next: ConsoleItem[] = [...consoleItems, [{ level: LogLevel.LEVEL_ERROR, message }]];
      return next.length > MAX_CONSOLE_ITEMS ? next.slice(next.length - MAX_CONSOLE_ITEMS) : next;
    });
  }, []);

  // Open the input dialog for a `kaja.ask(...)` call, resolving once the user
  // submits. Rejecting on cancel is handled by the dialog itself.
  const onAsk = useCallback((message: string) => {
    return new Promise<string>((resolve, reject) => {
      setAskPrompt({ message, value: "", resolve, reject });
    });
  }, []);

  const kajaRef = useRef<Kaja>(null);
  if (!kajaRef.current) {
    kajaRef.current = new Kaja(onMethodCallUpdate, onAsk);
  }

  const onClearConsole = useCallback(() => {
    setConsoleItems([]);
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
    ...(isWailsEnvironment() ? [{ key: "scripts", label: "Scripts", enabled: previewScripts }] : []),
    ...(isWailsEnvironment() ? [{ key: "mcp", label: "MCP server", enabled: previewMcp }] : []),
    { key: "previewApps", label: "Preview Apps", enabled: previewApps },
  ];

  // Variables exist to be read by scripts and by app configuration, both of which
  // are previews, so the tab rides along with whichever of them is on.
  const variablesEnabled = previewScripts || previewApps;

  const onToggleFeaturePreview = useCallback((key: string) => {
    if (key === "scripts") {
      setPreviewScripts((enabled) => !enabled);
    } else if (key === "mcp") {
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
    tabsRef.current.forEach((tab) => {
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
    tabsRef.current.forEach((tab) => {
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
          tabsRef.current.forEach((tab) => {
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

  useEffect(() => {
    const current = tabs[0];
    let title = "Kaja";
    if (current?.type === "scratch") {
      title = `${tabIdentity(current, scratchesRef.current).name} - Kaja`;
    } else if (current?.type === "script") {
      title = `${current.script.name} - Kaja`;
    }
    document.title = title;
    if (isWailsEnvironment()) {
      WindowSetTitle(title);
    }
  }, [tabs]);

  // Load the global scripts directory (desktop only). Scripts are independent
  // of apps; they bind to an app at run time via their import paths.
  const refreshScripts = useCallback(() => {
    if (!isWailsEnvironment() || !previewScripts) {
      setScripts(undefined);
      return;
    }
    ListScripts()
      .then((list) => setScripts((list ?? []).map((s) => ({ path: s.path, name: s.name })).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((err) => {
        console.error("Failed to list scripts", err);
        setScripts([]);
      });
  }, [previewScripts]);

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
      // ⌘P opens the switcher on the previous file, so ⌘P⏎ is "back". ⌘K is the
      // same surface: the open-files list is the file finder.
      if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setSwitcher(e.key === "p" ? "previous" : "first");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        const current = tabsRef.current[0];
        if (current) onCloseTabRef.current(current.id);
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
      for (const tab of tabsRef.current) {
        if (tab.type === "script" && scriptSaveTimers.current.has(tab.id)) {
          clearTimeout(scriptSaveTimers.current.get(tab.id)!);
          WriteScriptFile(tab.script.path, tab.model.getValue()).catch(() => {});
        }
      }
      scriptSaveTimers.current.clear();
      persistTabs();
      flushPersistedWrites();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persistTabs]);

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
    // Keep the MCP server's view of callable services in sync with whatever has
    // compiled so far. Apps are ordinary apps here (they carry an `app`
    // field), so they show up just like gRPC/Twirp apps. This runs on every
    // compilation update rather than waiting for all apps, so a slow or
    // failing app can't block the rest of the catalog.
    if (isWailsEnvironment() && previewMcpRef.current) {
      MCPSetCatalog(JSON.stringify(buildMcpCatalog(updatedApps))).catch(() => {});
    }

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
    // script; poke the open script editors so TypeScript re-resolves. (Task tabs
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
      if (tabsRestoredRef.current) {
        tabsRestoredRef.current = false;
        refreshOpenScratchEditors();
        return;
      }

      // Only auto-open the first method on first-time use (no previous tab memory)
      if (!hasTabMemory.current) {
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
   * worked-in one is left alone and the call starts a new scratch. Appending to
   * what you already have is the deliberate gesture (⌥click, or the + on the
   * row), so it can't happen by drifting.
   */
  const onMethodSelect = useCallback(
    (method: Method, service: Service, app: AppModel, mode: "preview" | "permanent" | "append" = "preview") => {
      const code = generateMethodEditorCode(app, service, method);
      const origin: ScratchOrigin = { appName: app.configuration.name, serviceName: service.name, methodName: method.name };
      const now = Date.now();
      const current = tabsRef.current[0];
      const currentScratch = current?.type === "scratch" ? scratchesRef.current.find((s) => s.id === current.scratchId) : undefined;

      if (mode === "append" && current?.type === "scratch" && currentScratch) {
        const merged = appendCall(current.model.getValue(), code);
        current.model.setValue(merged);
        updateScratch(currentScratch.id, (scratch) => withCode(scratch, merged, now));
        applyTabs((tabs) => keepTab(tabs, current.id));
        return;
      }

      if (currentScratch && isUntouched(currentScratch) && mode !== "permanent") {
        current.type === "scratch" && current.model.setValue(code);
        updateScratch(currentScratch.id, (scratch) => takeOver(scratch, code, origin, now));
        return;
      }

      const scratch = createScratch(code, origin, now);
      applyScratches((list) => [scratch, ...list]);
      applyTabs((tabs) => openScratchTab(tabs, scratch, mode === "permanent"));
    },
    [applyScratches, applyTabs, updateScratch],
  );

  const onScratchSelect = useCallback(
    (scratch: Scratch, permanent = false) => {
      applyTabs((tabs) => openScratchTab(tabs, scratch, permanent));
    },
    [applyTabs],
  );

  const onDeleteScratch = useCallback(
    (scratch: Scratch) => {
      const open = tabsRef.current.find((tab) => tab.type === "scratch" && tab.scratchId === scratch.id);
      if (open) applyTabs((tabs) => closeTab(tabs, open.id));
      applyScratches((list) => list.filter((candidate) => candidate.id !== scratch.id));
    },
    [applyScratches, applyTabs],
  );

  const onConfirmRenameScratch = useCallback(() => {
    if (!renameScratchTarget) return;
    updateScratch(renameScratchTarget.scratch.id, (scratch) => renameScratch(scratch, renameScratchTarget.title, Date.now()));
    setRenameScratchTarget(null);
  }, [renameScratchTarget, updateScratch]);

  const onScriptSelect = useCallback(
    async (script: Script, permanent = false) => {
      if (!isWailsEnvironment()) return;
      try {
        const file = await ReadScriptFile(script.path);
        if (!file) return;
        applyTabs((tabs) => openScriptTab(tabs, { path: file.path, name: file.name }, file.content, permanent));
      } catch (err) {
        showFileError(`Open failed: ${err}`);
      }
    },
    [applyTabs, showFileError],
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
        runTask(file.content, kaja, apps, onScriptError);
      } catch (err) {
        showFileError(`Run failed: ${err}`);
      }
    },
    [pinnedScriptPath, onScriptSelect, apps, showFileError, onScriptError],
  );

  const runContextMenuScriptRef = useRef(runContextMenuScript);
  runContextMenuScriptRef.current = runContextMenuScript;

  // Wire the native macOS "Run Kaja Script" text service.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("service:runScript", (text: string) => runContextMenuScriptRef.current(text));
    return () => unsub();
  }, []);

  // Auto-save: open script tabs persist to disk on edit (debounced). No ⌘S, no
  // dirty indicator.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const disposables: monaco.IDisposable[] = [];
    for (const tab of tabs) {
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
  }, [tabs, showFileError]);

  // Script tabs are file-backed, so disk is their source of truth. The persisted
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
      for (const tab of tabsRef.current) {
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
      if (!cancelled && reconciled) persistTabs();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘S saves the current editor (a method or a script) as a new named script.
  const onRequestSaveAsScript = useCallback(() => {
    if (!isWailsEnvironment() || !previewScriptsRef.current) return;
    const tab = tabsRef.current[0];
    if (!tab || (tab.type !== "scratch" && tab.type !== "script")) return;
    const defaultName =
      tab.type === "scratch"
        ? lowerFirst(
            tabIdentity(tab, scratchesRef.current)
              .name.replace(/[^A-Za-z0-9]+/g, " ")
              .trim()
              .split(" ")[0] || "scratch",
          )
        : tab.script.name.replace(/\.ts$/, "");
    setSaveAsError(undefined);
    setSaveAs({ name: defaultName, content: tab.model.getValue(), fromScratchId: tab.type === "scratch" ? tab.scratchId : undefined });
  }, []);

  const onSaveScratchAsScript = useCallback((scratch: Scratch) => {
    setSaveAsError(undefined);
    setSaveAs({
      name: lowerFirst(
        scratch.title
          .replace(/[^A-Za-z0-9]+/g, " ")
          .trim()
          .split(" ")[0] || "scratch",
      ),
      content: scratch.code,
      fromScratchId: scratch.id,
    });
  }, []);

  const onRequestSaveAsScriptRef = useRef(onRequestSaveAsScript);
  onRequestSaveAsScriptRef.current = onRequestSaveAsScript;

  // Wire the native File → Save menu item (⌘S).
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("menu:saveScript", () => onRequestSaveAsScriptRef.current());
    return () => unsub();
  }, []);

  // Show/hide the native File menu in step with the Scripts feature preview.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    EventsEmit("scripts:previewEnabled", previewScripts);
  }, [previewScripts]);

  // Start/stop the localhost MCP server in step with its feature preview, and
  // keep the connection details for the footer.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    MCPSetEnabled(previewMcp)
      .then((info) => {
        setMcpInfo(info);
        // Seed the server with the already-compiled apps/apps; otherwise the
        // catalog stays empty until the next compilation event.
        if (previewMcp) {
          MCPSetCatalog(JSON.stringify(buildMcpCatalog(appsRef.current))).catch(() => {});
        }
      })
      .catch((err) => showFileError(`MCP server: ${err}`));
  }, [previewMcp, showFileError]);

  // Run a script on behalf of the MCP server's run_script tool and report the
  // console output, return value, and the RPCs it made back to the Go side.
  useEffect(() => {
    if (!isWailsEnvironment()) return;
    const unsub = EventsOn("mcp:runScript", async (payload: { id: string; path: string; code: string }) => {
      const collected: MethodCall[] = [];
      mcpRunCollectorRef.current = collected;
      let result: { console: string[]; result?: unknown; error?: string; methodCalls: unknown[] };
      try {
        let source = payload.code;
        if (payload.path) {
          const file = await ReadScriptFile(payload.path);
          source = file?.content ?? "";
        }
        const kaja = kajaRef.current!;
        kaja.input = undefined;
        const captured = await runTaskCaptured(source, kaja, appsRef.current);
        result = { ...captured, methodCalls: collected.map(toMethodCallLog) };
      } catch (err) {
        result = { console: [], error: err instanceof Error ? err.message : String(err), methodCalls: collected.map(toMethodCallLog) };
      } finally {
        mcpRunCollectorRef.current = null;
      }
      MCPScriptResult(payload.id, JSON.stringify(result)).catch(() => {});
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
      applyTabs((tabs) => {
        const opened = openScriptTab(tabs, script, file.content, true);
        // The scratch became the file, so it doesn't linger as a copy.
        const source = saveAs.fromScratchId && opened.find((tab) => tab.type === "scratch" && tab.scratchId === saveAs.fromScratchId);
        return source ? closeTab(opened, source.id) : opened;
      });
      if (saveAs.fromScratchId) {
        const id = saveAs.fromScratchId;
        applyScratches((list) => list.filter((candidate) => candidate.id !== id));
      }
      setSaveAs(null);
      setSaveAsError(undefined);
    } catch (err) {
      setSaveAsError(String(err));
    }
  }, [saveAs, applyScratches, applyTabs]);

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
      applyTabs((tabs) => tabs.map((tab) => (tab.type === "script" && tab.script.path === oldPath ? { ...tab, script: renamed } : tab)));
      setPinnedScriptPath((current) => (current === oldPath ? renamed.path : current));
    },
    [applyTabs],
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
      const openTab = tabsRef.current.find((t) => t.type === "script" && t.script.path === original.path);
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
      applyTabs((tabs) => {
        const tab = tabs.find((candidate) => candidate.type === "script" && candidate.script.path === path);
        if (!tab) return tabs;
        // Cancel the pending auto-save so closing the tab can't recreate the
        // file that was just deleted.
        const timer = scriptSaveTimers.current.get(tab.id);
        if (timer) {
          clearTimeout(timer);
          scriptSaveTimers.current.delete(tab.id);
        }
        return closeTab(tabs, tab.id);
      });
    },
    [applyTabs],
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
          const tab = tabsRef.current.find((t) => t.type === "script" && t.script.path === payload.path);
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
            persistTabs();
          }
          break;
        }
        case "create": {
          const script: Script = { path: payload.path, name: payload.name ?? "" };
          setScripts((prev) => (prev && !prev.some((s) => s.path === script.path) ? [...prev, script].sort((a, b) => a.name.localeCompare(b.name)) : prev));
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
  }, [applyScriptRename, removeScriptFromUI, persistTabs]);

  // Picking a call from the switcher opens it for good and reveals it in the
  // sidebar, so the tree stays in step with what is on screen.
  const onSwitcherMethodSelect = useCallback(
    (method: Method, service: Service, app: AppModel) => {
      onMethodSelect(method, service, app, "permanent");
      setScrollToMethod({ method, service, app });
    },
    [onMethodSelect],
  );

  const onGoToDefinition = (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number) => {
    applyTabs((tabs) => openDefinitionTab(tabs, model, startLineNumber, startColumn));
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

  const onSelectTab = useCallback((id: string) => applyTabs((tabs) => activateTab(tabs, id)), [applyTabs]);

  // Track how tall each open editor's code is so the pane can be sized to it.
  // Derived from the line count rather than Monaco's content height: with
  // scrollBeyondLastLine on, content height grows with the editor itself, so
  // feeding it back into the pane height would only ever settle at the maximum.
  // The listeners belong to the editor and go away when the editor is disposed.
  const onEditorReady = useCallback(
    (tabId: string, editorInstance: monaco.editor.IStandaloneCodeEditor) => {
      editorRegistryRef.current.set(tabId, editorInstance);
      const report = () => {
        const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight);
        const height = (editorInstance.getModel()?.getLineCount() ?? 1) * lineHeight + EDITOR_PADDING;
        setEditorContentHeights((heights) => (heights[tabId] === height ? heights : { ...heights, [tabId]: height }));
      };
      report();
      editorInstance.onDidChangeModelContent(() => {
        report();
        // The first keystroke of an edit makes a preview file permanent. Only a
        // real one counts: the editor formats its model on open, and that must
        // not keep a file the user only glanced at.
        if (!editorInstance.hasTextFocus()) return;
        applyTabs((tabs) => keepTab(tabs, tabId));

        const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
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
    [applyTabs, updateScratch],
  );

  const onCloseTab = useCallback(
    (id: string) => {
      // The Variables tab holds edits that aren't anywhere else yet, so closing
      // it mid-edit asks first.
      if (tabsRef.current.find((tab) => tab.id === id)?.type === "variables" && variablesStateRef.current.dirty) {
        setClosingVariablesId(id);
        return;
      }
      applyTabs((tabs) => closeTab(tabs, id));
    },
    [applyTabs],
  );

  // Turning off the last preview that uses variables takes the open tab with it,
  // rather than leaving a tab behind with no way to open it again.
  useEffect(() => {
    if (variablesEnabled) return;
    const tab = tabsRef.current.find((candidate) => candidate.type === "variables");
    if (!tab) return;
    setVariablesState({ dirty: false, canSave: false, save: async () => {} });
    applyTabs((tabs) => closeTab(tabs, tab.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variablesEnabled]);

  // Close all drops to the empty state; the files stay in the switcher's "All
  // files" group, so nothing closed here is hard to get back.
  const onCloseAll = useCallback(() => {
    const variables = tabsRef.current.find((tab) => tab.type === "variables");
    if (variables && variablesStateRef.current.dirty) {
      setClosingVariablesId(variables.id);
      return;
    }
    applyTabs(() => []);
  }, [applyTabs]);

  // The </> button in the command row edits the current file as JSON: same
  // position, same icon, same ⌘J, on every file that has a JSON representation,
  // and absent on the ones that don't. It shares the row's action slot with Run
  // — a file is never both a script and a form.
  const currentTab = tabs[0];
  const jsonView =
    currentTab?.type === "appForm"
      ? { showing: currentTab.editMode === "json", back: "Edit as a form (⌘J)" }
      : currentTab?.type === "variables"
        ? { showing: currentTab.editMode === "json", back: "Edit as a table (⌘J)" }
        : undefined;

  const toggleJsonView = useCallback((): void => {
    const tab = tabsRef.current[0];
    if (tab?.type !== "appForm" && tab?.type !== "variables") return;
    if (tab.editMode === "json" && !tabJsonValidRef.current) return;
    applyTabs((tabs) =>
      tab.type === "appForm"
        ? setAppFormEditMode(tabs, tab.id, tab.editMode === "json" ? "form" : "json")
        : setVariablesEditMode(tabs, tab.id, tab.editMode === "json" ? "table" : "json"),
    );
  }, [applyTabs]);
  const toggleJsonViewRef = useRef(toggleJsonView);
  toggleJsonViewRef.current = toggleJsonView;
  const onCloseTabRef = useRef(onCloseTab);
  onCloseTabRef.current = onCloseTab;

  // The file on screen is the one Run runs, so its errors are the ones the row
  // reports — on the trigger, and as Run's reason for being disabled.
  const syntaxErrors = useSyntaxErrors(currentTab?.type === "scratch" || currentTab?.type === "script" ? currentTab.model : undefined);

  // Run the current file's editor contents. Triggered by Run in the command
  // row, by ⌘⏎ and by F5.
  const onRunCurrentTab = useCallback(() => {
    const tab = tabsRef.current[0];
    if (!tab || (tab.type !== "scratch" && tab.type !== "script")) {
      return;
    }
    const editor = editorRegistryRef.current.get(tab.id);
    if (!editor) {
      return;
    }
    const controller = new AbortController();
    setActiveRun({ tabId: tab.id, startedAt: Date.now(), controller, settled: false });
    runTask(editor.getValue(), kajaRef.current!, apps, onScriptError, controller.signal).finally(() =>
      setActiveRun((run) => (run?.controller === controller ? { ...run, settled: true } : run)),
    );
    // Running a file is working in it, so it stops being a preview.
    applyTabs((tabs) => keepTab(tabs, tab.id));
    // A run is the punctuation that settles a scratch: it is when the title is
    // re-read from the code, rather than jittering as you type.
    if (tab.type === "scratch") {
      updateScratch(tab.scratchId, (scratch) => markRun(scratch, editor.getValue(), Date.now()));
    }
  }, [apps, applyTabs, onScriptError, updateScratch]);

  // A generated method-call script issues its call without awaiting it, so the
  // script's own promise settles well before the response lands. The run is over
  // once the script has settled and nothing it started is still in flight.
  useEffect(() => {
    if (!activeRun?.settled) return;
    const inFlight = consoleItems.some((item) => "method" in item && item.timestamp >= activeRun.startedAt && isCallInFlight(item));
    if (!inFlight) {
      setActiveRun(null);
    }
  }, [consoleItems, activeRun]);

  // Stop aborts the calls the run has in flight; the script itself stops at the
  // call it was awaiting.
  const onStopActiveRun = useCallback(() => {
    setActiveRun((run) => {
      run?.controller.abort();
      return null;
    });
  }, []);

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

  // Opens the compile log, expanded on an app when one is named. Nothing else
  // opens it: compiling is reported in the status bar, and the log is where you
  // go when it has something to say.
  const onShowCompileLog = useCallback(
    (appName?: string) => {
      setCompileLogExpandApp(appName ? { name: appName } : undefined);
      applyTabs(openCompilerTab);
    },
    [applyTabs],
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
    setNewAppOpen(true);
  };

  // Picking a type in the New dialog opens the create form tab for that type. The
  // type is fixed at creation and not editable in the form afterwards.
  const onSelectAppType = (type: string) => {
    setNewAppOpen(false);
    applyTabs((tabs) => openAppFormTab(tabs, "create", buildApp("", type, {}, {})));
  };

  const onEditApp = (appName: string) => {
    const app = apps.find((p) => p.configuration.name === appName);
    if (app) {
      applyTabs((tabs) => openAppFormTab(tabs, "edit", app.configuration));
    }
  };

  // Working in an app's settings keeps the tab, so opening another app's settings
  // no longer reuses it.
  const onAppFormEdited = (id: string) => {
    applyTabs((tabs) => keepTab(tabs, id));
  };

  const closeAppFormTab = () => {
    applyTabs((tabs) => {
      const form = tabs.find((tab) => tab.type === "appForm");
      return form ? closeTab(tabs, form.id) : tabs;
    });
  };

  const onAppFormSubmit = async (app: ConfigurationApp, originalName?: string) => {
    closeAppFormTab();

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
    closeAppFormTab();
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
    applyTabs(openVariablesTab);
  }, [applyTabs]);

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

  const currentIsEditor = currentTab?.type === "scratch" || currentTab?.type === "script";
  const isHorizontalLayout = editorLayout === "horizontal" && currentIsEditor;

  const currentEditorContentHeight = currentIsEditor ? editorContentHeights[currentTab.id] : undefined;
  const autoEditorHeight =
    currentEditorContentHeight === undefined
      ? undefined
      : Math.min(Math.max(currentEditorContentHeight, MIN_EDITOR_HEIGHT), Math.max(MIN_EDITOR_HEIGHT, Math.round(windowHeight * MAX_EDITOR_HEIGHT_RATIO)));
  const effectiveEditorHeight = editorHeightAuto && autoEditorHeight !== undefined ? autoEditorHeight : editorHeight;
  effectiveEditorHeightRef.current = effectiveEditorHeight;

  // Only the Variables tab can hold edits nothing else has a copy of; a script
  // auto-saves and a call is scratch.
  const isDirty = (tab: TabModel) => tab.type === "variables" && variablesState.dirty;

  const openFiles: OpenSwitcherFile[] = tabs.map((tab) => ({
    ...tabIdentity(tab, scratches),
    key: tab.id,
    id: tab.id,
    preview: tab.preview,
    dirty: isDirty(tab),
    onOpen: () => onSelectTab(tab.id),
  }));

  // Everything else the sidebar can reach. Typing narrows across both groups, so
  // the switcher is also the file finder — which is why ⌘K lands here too.
  const otherFiles = useMemo<SwitcherFile[]>(() => {
    const openScratches = new Set(tabs.filter((tab) => tab.type === "scratch").map((tab) => tab.scratchId));
    const openScripts = new Set(tabs.filter((tab) => tab.type === "script").map((tab) => tab.script.path));
    const files: SwitcherFile[] = [];

    // Saved and unsaved sit in one run, in one vocabulary: they are all
    // scripts, and the icon is the whole difference.
    for (const script of scripts ?? []) {
      if (openScripts.has(script.path)) continue;
      files.push({
        key: `script:${script.path}`,
        name: script.name,
        path: "Scripts",
        origin: "",
        icon: FileCode,
        onOpen: () => void onScriptSelect(script, true),
      });
    }

    for (const scratch of scratches) {
      if (openScratches.has(scratch.id)) continue;
      files.push({
        key: `scratch:${scratch.id}`,
        name: scratch.title,
        path: "Scripts",
        origin: scratch.origin?.appName ?? "",
        icon: PenLine,
        onOpen: () => onScratchSelect(scratch, true),
      });
    }

    // The workspace surfaces come before the calls: there are two of them and
    // hundreds of calls, so at rest they'd never make the list otherwise.
    if (variablesEnabled && !tabs.some((tab) => tab.type === "variables")) {
      files.push({ key: "variables", name: "Variables", path: "Workspace", origin: "", icon: Braces, onOpen: onVariablesClick });
    }
    if (!tabs.some((tab) => tab.type === "compiler")) {
      files.push({ key: "compiler", name: "Compile log", path: "Output", origin: "", icon: ScrollText, onOpen: () => onShowCompileLog() });
    }

    for (const app of apps) {
      for (const service of app.services) {
        for (const method of service.methods) {
          const key = `${app.configuration.name}/${service.name}/${method.name}`;
          files.push({
            key: `call:${key}`,
            name: method.name,
            path: `${app.configuration.name} / ${service.name}`,
            origin: app.configuration.name,
            icon: FileCode,
            onOpen: () => onSwitcherMethodSelect(method, service, app),
          });
        }
      }
    }

    return files;
  }, [apps, scratches, scripts, tabs, variablesEnabled, onScratchSelect, onScriptSelect, onSwitcherMethodSelect, onVariablesClick, onShowCompileLog]);

  const running = currentTab !== undefined && activeRun?.tabId === currentTab.id;
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
      disabled={jsonView.showing && !tabJsonValid}
      onClick={toggleJsonView}
    />
  ) : undefined;

  // Bodies render in creation order, so bringing a file to the front never moves
  // a live editor in the DOM.
  const bodies = [...tabs].sort((a, b) => a.seq - b.seq);

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
                canDeleteApps={runtime.canUpdateConfiguration}
                onSelect={onMethodSelect}
                onScriptSelect={isWailsEnvironment() ? onScriptSelect : undefined}
                onRenameScript={isWailsEnvironment() ? onRenameScript : undefined}
                onDeleteScript={isWailsEnvironment() ? (script) => setDeleteScript(script) : undefined}
                onPinScript={isDesktopMac ? onPinScript : undefined}
                pinnedScriptPath={pinnedScriptPath}
                scratches={scratches}
                currentScratchId={currentTab?.type === "scratch" ? currentTab.scratchId : undefined}
                currentScratchOrigin={currentTab?.type === "scratch" ? scratches.find((s) => s.id === currentTab.scratchId)?.origin : undefined}
                onScratchSelect={onScratchSelect}
                onRenameScratch={(scratch) => setRenameScratchTarget({ scratch, title: scratch.title })}
                onDeleteScratch={onDeleteScratch}
                onSaveScratchAsScript={isWailsEnvironment() && previewScripts ? onSaveScratchAsScript : undefined}
                onShowAllScratches={() => setSwitcher("first")}
                currentScriptPath={currentTab?.type === "script" ? currentTab.script.path : undefined}
                scrollToMethod={scrollToMethod}
                onShowCompileLog={onShowCompileLog}
                onRecompileApp={onRecompile}
                onNewAppClick={onNewAppClick}
                onVariablesClick={variablesEnabled ? onVariablesClick : undefined}
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
              switcher={
                <FileSwitcher
                  openFiles={openFiles}
                  otherFiles={otherFiles}
                  errorCount={currentIsEditor ? syntaxErrors.count : 0}
                  open={switcher !== undefined}
                  onOpenChange={(open) => setSwitcher(open ? "first" : undefined)}
                  highlightPrevious={switcher === "previous"}
                  onClose={onCloseTab}
                  onCloseAll={onCloseAll}
                />
              }
              recent={tabs.slice(1, 3).map((tab) => ({ id: tab.id, name: tabIdentity(tab, scratches).name, dirty: isDirty(tab) }))}
              onSelectRecent={onSelectTab}
              action={action}
              onSearch={() => setSwitcher("first")}
              layout={editorLayout}
              onToggleLayout={onToggleEditorLayout}
            />
            {tabs.length === 0 && configurationLoaded && apps.length === 0 && <FirstAppBlankslate onNewAppClick={onNewAppClick} />}
            {tabs.length === 0 && (apps.length > 0 || !configurationLoaded) && <NoFileBlankslate onOpenSwitcher={() => setSwitcher("first")} />}
            {tabs.length > 0 && (
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
                    <div key={tab.id} style={{ display: tab.id === currentTab?.id ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                      {tab.type === "compiler" && (
                        <Compiler apps={apps} configurationLoaded={configurationLoaded} onNewAppClick={onNewAppClick} expandApp={compileLogExpandApp} />
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
                          onEdited={() => onAppFormEdited(tab.id)}
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
                          onEditModeChange={(editMode) => applyTabs((tabs) => setVariablesEditMode(tabs, tab.id, editMode))}
                          onJsonValidChange={setTabJsonValid}
                          active={tab.id === currentTab?.id}
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
                      <Console items={consoleItems} onClear={onClearConsole} />
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
          apps={apps}
          configurationLoaded={configurationLoaded}
          onShowCompileLog={onShowCompileLog}
          onRecompile={onRecompile}
        />
      </div>
      {saveAs && (
        <Dialog
          title="Save as script"
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
              <Input
                autoFocus
                className="pr-9"
                value={saveAs.name}
                onChange={(e) => setSaveAs((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmSaveAsScript();
                  }
                }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">.ts</span>
            </div>
            {saveAsError && <FormControl.Validation variant="error">{saveAsError}</FormControl.Validation>}
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
              onClick: () => {
                askPrompt.resolve(askPrompt.value);
                setAskPrompt(null);
              },
            },
          ]}
        >
          <FormControl>
            <FormControl.Label>{askPrompt.message}</FormControl.Label>
            <Input
              autoFocus
              value={askPrompt.value}
              onChange={(e) => setAskPrompt((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  askPrompt.resolve(askPrompt.value);
                  setAskPrompt(null);
                }
              }}
            />
          </FormControl>
        </Dialog>
      )}
      {newAppOpen && <NewAppDialog appsPreviewEnabled={previewApps} onClose={() => setNewAppOpen(false)} onSelect={onSelectAppType} />}
      {renameScratchTarget && (
        <Dialog
          title="Rename scratch"
          onClose={() => setRenameScratchTarget(null)}
          footerButtons={[
            { content: "Cancel", onClick: () => setRenameScratchTarget(null) },
            { content: "Rename", variant: "default", onClick: onConfirmRenameScratch },
          ]}
        >
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <Input
              autoFocus
              value={renameScratchTarget.title}
              onChange={(e) => setRenameScratchTarget((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onConfirmRenameScratch();
                }
              }}
            />
            <FormControl.Caption>A scratch names itself from the code it runs. Naming it yourself settles it for good.</FormControl.Caption>
          </FormControl>
        </Dialog>
      )}
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
      {closingVariablesId !== undefined && (
        <Dialog
          title="Variables has unsaved changes"
          width="sm"
          onClose={() => setClosingVariablesId(undefined)}
          footerButtons={[
            { content: "Cancel", onClick: () => setClosingVariablesId(undefined) },
            {
              content: "Discard",
              variant: "destructive",
              onClick: () => {
                const id = closingVariablesId;
                setClosingVariablesId(undefined);
                setVariablesState({ dirty: false, canSave: false, save: async () => {} });
                applyTabs((tabs) => closeTab(tabs, id));
              },
            },
            ...(variablesState.canSave
              ? [
                  {
                    content: "Save",
                    variant: "default" as const,
                    onClick: () => {
                      const id = closingVariablesId;
                      setClosingVariablesId(undefined);
                      void variablesState.save().then(() => applyTabs((tabs) => closeTab(tabs, id)));
                    },
                  },
                ]
              : []),
          ]}
        >
          <p className="text-sm text-muted-foreground">
            The rows are the only copy of these edits. Values already written to this machine's keychain are kept either way.
          </p>
        </Dialog>
      )}
      {fileError && (
        <div style={{ position: "fixed", top: 36, left: "50%", transform: "translateX(-50%)", zIndex: 1000, maxWidth: 640 }}>
          <Alert variant="danger">{fileError}</Alert>
        </div>
      )}
    </>
  );
}

// toMethodCallLog flattens a MethodCall into the shape the MCP server returns to
// the agent (service/method plus best-effort JSON of the request and response).
function toMethodCallLog(call: MethodCall) {
  return {
    service: call.service.name,
    method: call.method.name,
    input: call.input,
    output: call.output,
    error: call.error ? String(call.error?.message ?? call.error) : undefined,
  };
}

// buildMcpCatalog turns the compiled apps into the catalog the MCP server
// exposes via list_services and the stub resources. Apps are included here just
// like gRPC/Twirp apps — for the MCP consumer there is no difference, both
// expose callable services. Only successfully compiled apps with services
// are listed, so a pending or failed app (or app) leaves the rest intact.
function buildMcpCatalog(apps: AppModel[]) {
  const compiled = apps.filter((app) => app.compilation.status === "success" && app.services.length > 0);
  return {
    apps: compiled.map((app) => ({
      name: app.configuration.name,
      services: app.services.map((service: Service) => ({
        name: service.name,
        packageName: service.packageName,
        importPath: service.sourcePath,
        methods: service.methods.map((method) => ({
          name: method.name,
          serverStreaming: method.serverStreaming,
          clientStreaming: method.clientStreaming,
        })),
      })),
    })),
    sources: compiled.flatMap((app) => app.sources.map((source) => ({ path: source.importPath, content: source.file.text }))),
  };
}
