import { useMediaQuery } from "./useMediaQuery";
import { Alert } from "./components/alert";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { Dialog } from "./components/dialog";
import { FormControl } from "./components/form-control";
import { IconButton } from "./components/icon-button";
import { Input } from "./components/input";
import { SimpleTooltip } from "./components/tooltip";
import { Braces, Code, Columns2, Rows2, PanelLeftClose, PanelLeftOpen, ScrollText } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { GetStartedBlankslate } from "./GetStartedBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Gutter } from "./Gutter";
import { AskCancelledError, isCallInFlight, Kaja, MethodCall } from "./kaja";
import { appHeaders, appParameters, appType, buildApp } from "./appTypes";
import { createPendingApp, createAppRef, getDefaultMethod, Method, App as AppModel, Script, Service, Transport, updateAppRef } from "./apps";
import { Sidebar, TRAFFIC_LIGHTS_INSET } from "./Sidebar";
import { NewAppDialog } from "./NewAppDialog";
import { SearchPopup } from "./SearchPopup";
import { StatusBar, ColorMode } from "./StatusBar";
import { FeaturePreview } from "./FeaturePreviews";
import { AppForm } from "./AppForm";
import { registerKajaModule, setValueCompletionApps } from "./Editor";
import { monacoTheme } from "./monacoTheme";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { Configuration, ConfigurationApp, LogLevel, VariableStatus } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  addDefinitionTab,
  openAppFormTab,
  addScriptTab,
  addTaskTab,
  addVariablesTab,
  getAppFormTabIcon,
  getAppFormTabIndex,
  getAppFormTabLabel,
  getScriptTabLabel,
  getTabLabel,
  getVariablesTabIndex,
  linkTabsToApps,
  markInteraction,
  PersistedTabState,
  restoreTabs,
  serializeTabs,
  TabModel,
  keepAppFormTab,
  setAppFormEditMode,
} from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Variables, VariablesSave } from "./Variables";
import { Task } from "./Task";
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

// Height of the tab strip sitting above the editor, part of the editor pane.
const TAB_STRIP_HEIGHT = 35;
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
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  // Where each variable's value came from. A value the configuration only names
  // never travels, so this is all the Variables tab knows about it.
  const [variableStatus, setVariableStatus] = useState<VariableStatus[]>([]);
  const variablesDirtyRef = useRef(false);
  // Index of the Variables tab a close gesture is waiting on, while it asks
  // whether to discard the edits.
  const [discardVariablesIndex, setDiscardVariablesIndex] = useState<number>();
  const [apps, setApps] = useState<AppModel[]>([]);
  const restoredState = useRef(restoreTabs(getPersistedValue<PersistedTabState>("tabs"))).current;
  const [tabs, setTabs] = useState<TabModel[]>(restoredState?.tabs ?? []);
  const [activeTabIndex, setActiveTabIndex] = useState(restoredState?.activeIndex ?? 0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToMethod, setScrollToMethod] = useState<{ method: Method; service: Service; app: AppModel }>();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIndexRef = useRef(activeTabIndex);
  activeTabIndexRef.current = activeTabIndex;
  const editorRegistryRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());
  const hasTabMemory = useRef(getPersistedValue<PersistedTabState>("tabs") !== undefined);
  const tabsRestoredRef = useRef(restoredState !== null && restoredState.tabs.some((t) => t.type === "task"));
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
  const [saveAs, setSaveAs] = useState<{ name: string; content: string } | null>(null);
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
  // Whether the app settings tab's JSON parses. It gates switching back to the
  // form, which is why it lives out here with the control that does the switch.
  const [appFormJsonValid, setAppFormJsonValid] = useState(true);
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // One-shot signal to expand an app's logs when the compile log is opened for it.
  const [compileLogExpandApp, setCompileLogExpandApp] = useState<{ name: string }>();
  // Rename dialog and delete confirmation for scripts (right-click menu).
  const [renameScript, setRenameScript] = useState<{ script: Script; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
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

  // Dispose task tabs for given app names, returns filtered tabs
  const disposeTaskTabsForApps = useCallback((appNames: Set<string>, prevTabs: TabModel[]): TabModel[] => {
    const newTabs: TabModel[] = [];
    for (const tab of prevTabs) {
      if (tab.type === "task" && appNames.has(tab.originApp.configuration.name)) {
        editorRegistryRef.current.delete(tab.id);
        tab.model.dispose();
      } else {
        newTabs.push(tab);
      }
    }
    return newTabs;
  }, []);

  // Refresh open task editors to trigger re-validation
  const refreshOpenTaskEditors = useCallback(() => {
    tabsRef.current.forEach((tab) => {
      if (tab.type === "task") {
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

  const captureActiveViewState = useCallback(() => {
    const currentTabs = tabsRef.current;
    const currentIndex = activeTabIndexRef.current;
    const activeTab = currentTabs[currentIndex];
    if (activeTab?.type === "task") {
      const editor = editorRegistryRef.current.get(activeTab.id);
      if (editor) {
        activeTab.viewState = editor.saveViewState() ?? undefined;
      }
    }
  }, []);

  const persistTabs = useCallback(() => {
    captureActiveViewState();
    const state = serializeTabs(tabsRef.current, activeTabIndexRef.current, (tabId) => {
      const editor = editorRegistryRef.current.get(tabId);
      return editor?.saveViewState();
    });
    setPersistedValue("tabs", state);
  }, [captureActiveViewState]);

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
        const { updatedApps, removedNames, renames } = syncAppsFromConfiguration(newConfiguration, prevApps, previousVariables);

        // Clean up task tabs for removed apps
        if (removedNames.size > 0) {
          setTabs((prevTabs) => {
            const newTabs = disposeTaskTabsForApps(removedNames, prevTabs);
            if (updatedApps.length === 0) {
              setSelectedMethod(undefined);
            }
            if (newTabs.length !== prevTabs.length) {
              setActiveTabIndex((idx) => Math.min(idx, Math.max(0, newTabs.length - 1)));
            }
            return newTabs;
          });
        }

        // Remap import paths in open task editors and refresh
        if (renames.size > 0) {
          tabsRef.current.forEach((tab) => {
            if (tab.type === "task") {
              let value = tab.model.getValue();
              for (const [oldName, newName] of renames) {
                value = remapEditorCode(value, oldName, newName);
              }
              tab.model.setValue(value);
            }
          });
        }

        return updatedApps;
      });
    },
    [syncAppsFromConfiguration, disposeTaskTabsForApps],
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
    document.body.style.backgroundColor = colorMode === "night" ? "#0d1117" : "#ffffff";
    // Drive the shadcn theme tokens. The class goes on <html> so Radix portals
    // (rendered into <body>) are themed too.
    document.documentElement.classList.toggle("dark", colorMode === "night");
  }, [colorMode]);

  useEffect(() => {
    const active = tabs[activeTabIndex];
    let title = "Kaja";
    if (active?.type === "task" && active.originApp) {
      title = `${active.originApp.configuration.name} - Kaja`;
    } else if (active?.type === "script") {
      title = `${active.script.name} - Kaja`;
    }
    document.title = title;
    if (isWailsEnvironment()) {
      WindowSetTitle(title);
    }
  }, [tabs, activeTabIndex]);

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
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen(true);
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

      // If tabs were restored from persisted state, link them to compiled apps
      if (tabsRestoredRef.current) {
        tabsRestoredRef.current = false;
        setTabs((prevTabs) => {
          const { tabs: linkedTabs, removedTabIds } = linkTabsToApps(prevTabs, updatedApps);
          removedTabIds.forEach((id) => editorRegistryRef.current.delete(id));
          if (removedTabIds.length > 0) {
            setActiveTabIndex((idx) => Math.min(idx, Math.max(0, linkedTabs.length - 1)));
          }
          const clampedIndex = Math.min(activeTabIndexRef.current, Math.max(0, linkedTabs.length - 1));
          const activeTab = linkedTabs[clampedIndex];
          if (activeTab?.type === "task") {
            setSelectedMethod(activeTab.originMethod);
          }
          return linkedTabs;
        });
        // Force TypeScript to revalidate restored models now that source models exist
        refreshOpenTaskEditors();
        return;
      }

      // Only auto-open the first method on first-time use (no previous tab memory)
      if (!hasTabMemory.current) {
        const defaultMethodAndService = getDefaultMethod(updatedApps[0].services);
        setSelectedMethod(defaultMethodAndService?.method);

        if (!defaultMethodAndService) {
          return;
        }

        setTabs((prevTabs) => {
          prevTabs.forEach((tab) => {
            if (tab.type === "task") {
              editorRegistryRef.current.delete(tab.id);
              tab.model.dispose();
            }
          });
          const result = addTaskTab([], defaultMethodAndService.method, defaultMethodAndService.service, updatedApps[0]);
          setActiveTabIndex(result.activeIndex);
          return result.tabs;
        });
      }
    }
  };

  const { configurationLoaded } = useCompilation(apps, onCompilationUpdate, (loaded, status) => {
    setConfiguration(loaded);
    setVariableStatus(status);
  });

  const onMethodSelect = (method: Method, service: Service, app: AppModel) => {
    captureActiveViewState();
    setSelectedMethod(method);
    setTabs((tabs) => {
      const result = addTaskTab(tabs, method, service, app);
      setActiveTabIndex(result.activeIndex);
      return result.tabs;
    });
    persistTabs();
  };

  const showFileError = useCallback((message: string) => {
    setFileError(message);
    window.setTimeout(() => setFileError((current) => (current === message ? undefined : current)), 4000);
  }, []);

  const onScriptSelect = useCallback(
    async (script: Script) => {
      if (!isWailsEnvironment()) return;
      try {
        const file = await ReadScriptFile(script.path);
        if (!file) return;
        captureActiveViewState();
        setTabs((prevTabs) => {
          const result = addScriptTab(prevTabs, { path: file.path, name: file.name }, file.content);
          setActiveTabIndex(result.activeIndex);
          return result.tabs;
        });
        persistTabs();
      } catch (err) {
        showFileError(`Open failed: ${err}`);
      }
    },
    [captureActiveViewState, persistTabs, showFileError],
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

  // Flush any pending debounced write for a script tab immediately (e.g. before
  // its model is disposed). No-op if nothing is pending.
  const flushScriptTab = useCallback(
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

  // ⌘S saves the active editor (a method or a script) as a new named script.
  const onRequestSaveAsScript = useCallback(() => {
    if (!isWailsEnvironment() || !previewScriptsRef.current) return;
    const tab = tabsRef.current[activeTabIndexRef.current];
    if (!tab || (tab.type !== "task" && tab.type !== "script")) return;
    const defaultName = tab.type === "task" ? lowerFirst(tab.originMethod.name) : getScriptTabLabel(tab);
    setSaveAsError(undefined);
    setSaveAs({ name: defaultName, content: tab.model.getValue() });
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
      captureActiveViewState();
      setTabs((prevTabs) => {
        const result = addScriptTab(prevTabs, script, file.content);
        setActiveTabIndex(result.activeIndex);
        return result.tabs;
      });
      persistTabs();
      setSaveAs(null);
      setSaveAsError(undefined);
    } catch (err) {
      setSaveAsError(String(err));
    }
  }, [saveAs, captureActiveViewState, persistTabs]);

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
      setTabs((prev) => prev.map((t) => (t.type === "script" && t.script.path === oldPath ? { ...t, script: renamed } : t)));
      setPinnedScriptPath((current) => (current === oldPath ? renamed.path : current));
      persistTabs();
    },
    [persistTabs],
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
      setTabs((prevTabs) => {
        const idx = prevTabs.findIndex((t) => t.type === "script" && t.script.path === path);
        if (idx === -1) return prevTabs;
        const tab = prevTabs[idx];
        if (tab.type !== "script") return prevTabs;
        // Cancel any pending auto-save so we don't recreate the deleted file.
        const timer = scriptSaveTimers.current.get(tab.id);
        if (timer) {
          clearTimeout(timer);
          scriptSaveTimers.current.delete(tab.id);
        }
        editorRegistryRef.current.delete(tab.id);
        tab.model.dispose();
        const newTabs = prevTabs.filter((_, i) => i !== idx);
        setActiveTabIndex((cur) => (idx === cur ? Math.max(0, newTabs.length - 1) : idx < cur ? cur - 1 : cur));
        return newTabs;
      });
      persistTabs();
    },
    [persistTabs],
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

  const onSearchMethodSelect = (method: Method, service: Service, app: AppModel) => {
    onMethodSelect(method, service, app);
    setScrollToMethod({ method, service, app });
  };

  const onGoToDefinition = (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number) => {
    setTabs((tabs) => {
      tabs = addDefinitionTab(tabs, model, startLineNumber, startColumn);
      setActiveTabIndex(tabs.length - 1);
      return tabs;
    });
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

  const onSelectTab = (index: number) => {
    captureActiveViewState();
    setActiveTabIndex(index);
    persistTabs();
  };

  // Track how tall each open editor's code is so the pane can be sized to it.
  // Derived from the line count rather than Monaco's content height: with
  // scrollBeyondLastLine on, content height grows with the editor itself, so
  // feeding it back into the pane height would only ever settle at the maximum.
  // The listeners belong to the editor and go away when the editor is disposed.
  const onEditorReady = useCallback((tabId: string, editorInstance: monaco.editor.IStandaloneCodeEditor) => {
    editorRegistryRef.current.set(tabId, editorInstance);
    const report = () => {
      const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight);
      const height = (editorInstance.getModel()?.getLineCount() ?? 1) * lineHeight + EDITOR_PADDING;
      setEditorContentHeights((heights) => (heights[tabId] === height ? heights : { ...heights, [tabId]: height }));
    };
    report();
    editorInstance.onDidChangeModelContent(report);
    editorInstance.onDidChangeModel(report);
  }, []);

  const disposeTabEditor = (tab: TabModel) => {
    if (tab.type === "task" || tab.type === "script") {
      flushScriptTab(tab);
      editorRegistryRef.current.delete(tab.id);
      setEditorContentHeights(({ [tab.id]: _removed, ...rest }) => rest);
      tab.model.dispose();
    }
  };

  const onCloseTab = (index: number) => {
    // The Variables tab holds edits that aren't anywhere else yet, so closing it
    // mid-edit asks first.
    if (tabsRef.current[index]?.type === "variables" && variablesDirtyRef.current) {
      setDiscardVariablesIndex(index);
      return;
    }
    closeTab(index);
  };

  const closeTab = (index: number) => {
    setTabs((prevTabs) => {
      const tab = prevTabs[index];
      if (tab) disposeTabEditor(tab);
      const newTabs = prevTabs.filter((_, i) => i !== index);
      const newActiveIndex = index === activeTabIndex ? Math.max(0, newTabs.length - 1) : index < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
    });
    persistTabs();
  };

  // Turning off the last preview that uses variables takes the open tab with it,
  // rather than leaving a tab behind with no way to open it again.
  useEffect(() => {
    if (variablesEnabled) return;
    const index = getVariablesTabIndex(tabsRef.current);
    if (index === -1) return;
    variablesDirtyRef.current = false;
    closeTab(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variablesEnabled]);

  const onCloseAll = () => {
    setTabs((prevTabs) => {
      prevTabs.forEach(disposeTabEditor);
      setActiveTabIndex(0);
      return [];
    });
    persistTabs();
  };

  const onCloseOthers = (keepIndex: number) => {
    setTabs((prevTabs) => {
      prevTabs.forEach((tab, i) => {
        if (i !== keepIndex) disposeTabEditor(tab);
      });
      setActiveTabIndex(0);
      return prevTabs.filter((_, i) => i === keepIndex);
    });
    persistTabs();
  };

  const appFormTab = tabs[activeTabIndex];
  const appFormControls =
    appFormTab?.type === "appForm" ? (
      <IconButton
        icon={Code}
        aria-label={appFormTab.editMode === "json" ? "Edit as a form" : "Edit as JSON"}
        variant="ghost"
        size="sm"
        tooltip={false}
        disabled={appFormTab.editMode === "json" && !appFormJsonValid}
        className={appFormTab.editMode === "json" ? "bg-accent text-foreground" : undefined}
        onClick={() => setTabs((tabs) => setAppFormEditMode(tabs, activeTabIndex, appFormTab.editMode === "json" ? "form" : "json"))}
      />
    ) : undefined;

  // Double-clicking a preview tab's title keeps it, the same gesture editors use.
  const onKeepTab = (index: number) => {
    setTabs((tabs) => keepAppFormTab(tabs, index));
  };

  // Run the active task/script tab's editor contents. Triggered by the Run
  // button floating over the editor, by ⌘⏎ and by F5.
  const onRunActiveTab = useCallback(() => {
    const index = activeTabIndexRef.current;
    const tab = tabsRef.current[index];
    if (!tab || (tab.type !== "task" && tab.type !== "script")) {
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
    if (tab.type === "task") {
      setTabs((tabs) => markInteraction(tabs, index));
      persistTabs();
    }
  }, [apps, persistTabs, onScriptError]);

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
        onRunActiveTab();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRunActiveTab]);

  // Opens the compile log, expanded on an app when one is named. Nothing else
  // opens it: compiling is reported in the status bar, and the log is where you
  // go when it has something to say.
  const onShowCompileLog = (appName?: string) => {
    setCompileLogExpandApp(appName ? { name: appName } : undefined);
    setTabs((tabs) => {
      const compilerIndex = tabs.findIndex((tab) => tab.type === "compiler");
      if (compilerIndex === -1) {
        const newTabs: TabModel[] = [...tabs, { type: "compiler" as const }];
        setActiveTabIndex(newTabs.length - 1);
        return newTabs;
      } else {
        setActiveTabIndex(compilerIndex);
        return tabs;
      }
    });
    persistTabs();
  };

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
    setTabs((tabs) => {
      const { tabs: newTabs, activeIndex } = openAppFormTab(tabs, "create", buildApp("", type, {}, {}));
      setActiveTabIndex(activeIndex);
      return newTabs;
    });
  };

  const onEditApp = (appName: string) => {
    const app = apps.find((p) => p.configuration.name === appName);
    if (app) {
      setTabs((tabs) => {
        const { tabs: newTabs, activeIndex } = openAppFormTab(tabs, "edit", app.configuration);
        setActiveTabIndex(activeIndex);
        return newTabs;
      });
    }
  };

  // Working in an app's settings keeps the tab, so opening another app's settings
  // no longer reuses it.
  const onAppFormEdited = () => {
    setTabs((tabs) => keepAppFormTab(tabs, getAppFormTabIndex(tabs)));
  };

  const closeAppFormTab = () => {
    setTabs((prevTabs) => {
      const formIndex = getAppFormTabIndex(prevTabs);
      if (formIndex === -1) return prevTabs;
      const newTabs = prevTabs.filter((_, i) => i !== formIndex);
      const newActiveIndex = formIndex === activeTabIndex ? Math.max(0, newTabs.length - 1) : formIndex < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
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

  const onVariablesDirtyChange = useCallback((dirty: boolean) => {
    variablesDirtyRef.current = dirty;
  }, []);

  const onVariablesClick = () => {
    setTabs((tabs) => {
      const { tabs: newTabs, activeIndex } = addVariablesTab(tabs);
      setActiveTabIndex(activeIndex);
      return newTabs;
    });
  };

  // Saving the Variables tab is two things: the configuration, which names the
  // variables, and the values kaja.json doesn't carry, which go to this
  // machine's store. The configuration goes first, so a failed save leaves
  // nothing stored for a variable that doesn't exist.
  const onVariablesSave = async ({ variables, stored, cleared }: VariablesSave) => {
    if (!configuration) {
      return;
    }

    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: { ...configuration, variables } });

    let status = response.variableStatus;
    for (const name of cleared) {
      status = (await client.clearStoredValue({ name })).response.variableStatus;
    }
    for (const { name, value } of stored) {
      status = (await client.setStoredValue({ name, value })).response.variableStatus;
    }
    setVariableStatus(status);

    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
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
      refreshOpenTaskEditors();
    }
  };

  // With the sidebar open its own header holds the macOS traffic lights; collapsed,
  // this bar is what the window's left corner lands on, so it takes over the inset.
  const topBarInset = isDesktopMac && sidebarCollapsed ? TRAFFIC_LIGHTS_INSET : 12;

  const activeTab = tabs[activeTabIndex];
  const isActiveTaskTab = activeTab?.type === "task" || activeTab?.type === "script";
  const isHorizontalLayout = editorLayout === "horizontal" && isActiveTaskTab;
  const activeScriptPath = activeTab?.type === "script" ? activeTab.script.path : undefined;

  const activeEditorContentHeight = activeTab?.type === "task" || activeTab?.type === "script" ? editorContentHeights[activeTab.id] : undefined;
  const autoEditorHeight =
    activeEditorContentHeight === undefined
      ? undefined
      : Math.min(
          Math.max(activeEditorContentHeight + TAB_STRIP_HEIGHT, MIN_EDITOR_HEIGHT),
          Math.max(MIN_EDITOR_HEIGHT, Math.round(windowHeight * MAX_EDITOR_HEIGHT_RATIO)),
        );
  const effectiveEditorHeight = editorHeightAuto && autoEditorHeight !== undefined ? autoEditorHeight : editorHeight;
  effectiveEditorHeightRef.current = effectiveEditorHeight;

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
                canDeleteApps={configuration?.system?.canUpdateConfiguration ?? false}
                onSelect={onMethodSelect}
                onScriptSelect={isWailsEnvironment() ? onScriptSelect : undefined}
                onRenameScript={isWailsEnvironment() ? onRenameScript : undefined}
                onDeleteScript={isWailsEnvironment() ? (script) => setDeleteScript(script) : undefined}
                onPinScript={isDesktopMac ? onPinScript : undefined}
                pinnedScriptPath={pinnedScriptPath}
                currentMethod={selectedMethod}
                currentScriptPath={activeScriptPath}
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
            <div
              className="flex h-[30px] shrink-0 items-center border-b border-border bg-background"
              style={{ "--wails-draggable": "drag" } as React.CSSProperties}
            >
              {/* A panel toggle reads as "this edge", so it sits against the sidebar seam.
                  It belongs to this pane, not to the sidebar, so it keeps its place when
                  the sidebar collapses — except on the macOS desktop, where collapsing
                  leaves this bar under the window's traffic lights and the toggle has to
                  clear them the way the sidebar header does. */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", paddingLeft: topBarInset }}>
                <div style={{ display: "flex", "--wails-draggable": "no-drag" } as React.CSSProperties}>
                  <SimpleTooltip
                    text={
                      sidebarCollapsed
                        ? `Show sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)`
                        : `Hide sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)`
                    }
                    side="bottom"
                  >
                    <IconButton
                      icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
                      aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                      onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                      size="sm"
                      variant="ghost"
                      tooltip={false}
                    />
                  </SimpleTooltip>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, "--wails-draggable": "no-drag" } as React.CSSProperties}>
                <div
                  onClick={() => setIsSearchOpen(true)}
                  className="flex shrink-0 cursor-pointer select-none items-center rounded-md border border-border bg-muted px-3 py-0.5 text-xs text-muted-foreground"
                >
                  {navigator.platform.startsWith("Mac") ? "⌘K" : "Ctrl+K"} to search
                </div>
              </div>
              {/* Every control on this pane's right edge — here, in the tab strip, in the
                  console header — puts its icon on the same vertical line, 16px in. The
                  padding is that line minus the button's own centering room. */}
              <div
                style={
                  {
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    justifyContent: "flex-end",
                    paddingRight: 10,
                    gap: 2,
                    "--wails-draggable": "no-drag",
                  } as React.CSSProperties
                }
              >
                <SimpleTooltip text={editorLayout === "vertical" ? "Side-by-side layout" : "Top-bottom layout"} side="bottom">
                  <IconButton
                    icon={editorLayout === "vertical" ? Columns2 : Rows2}
                    aria-label={editorLayout === "vertical" ? "Switch to side-by-side layout" : "Switch to top-bottom layout"}
                    onClick={onToggleEditorLayout}
                    size="sm"
                    variant="ghost"
                    tooltip={false}
                  />
                </SimpleTooltip>
              </div>
            </div>
            {tabs.length === 0 && configurationLoaded && apps.length === 0 && <FirstAppBlankslate onNewAppClick={onNewAppClick} />}
            {tabs.length === 0 && (apps.length > 0 || !configurationLoaded) && <GetStartedBlankslate />}
            {tabs.length > 0 && (
              <div style={{ flex: 1, display: "flex", flexDirection: isHorizontalLayout ? "row" : "column", minHeight: 0 }}>
                <div
                  style={{
                    height: isActiveTaskTab && !isHorizontalLayout ? effectiveEditorHeight : undefined,
                    width: isActiveTaskTab && isHorizontalLayout ? editorWidth : undefined,
                    flexGrow: isActiveTaskTab ? 0 : 1,
                    flexShrink: 0,
                    flexBasis: isActiveTaskTab ? "auto" : 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    minWidth: 0,
                  }}
                >
                  <Tabs
                    activeTabIndex={activeTabIndex}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onCloseAll={onCloseAll}
                    onCloseOthers={onCloseOthers}
                    onKeepTab={onKeepTab}
                    controls={appFormControls}
                  >
                    {tabs.map((tab, index) => {
                      if (tab.type === "compiler") {
                        return (
                          <Tab tabId="compiler" tabLabel="Compile log" icon={ScrollText} key="compiler">
                            <Compiler apps={apps} configurationLoaded={configurationLoaded} onNewAppClick={onNewAppClick} expandApp={compileLogExpandApp} />
                          </Tab>
                        );
                      }

                      if (tab.type === "task") {
                        return (
                          <Tab tabId={tab.id} tabLabel={tab.originMethod.name} isEphemeral={!tab.hasInteraction && index === tabs.length - 1} key="task">
                            <Task
                              model={tab.model}
                              onGoToDefinition={onGoToDefinition}
                              onEditorReady={(editor) => onEditorReady(tab.id, editor)}
                              viewState={tab.viewState}
                              onRun={onRunActiveTab}
                              onStop={onStopActiveRun}
                              running={activeRun?.tabId === tab.id}
                              startedAt={activeRun?.tabId === tab.id ? activeRun.startedAt : undefined}
                            />
                          </Tab>
                        );
                      }

                      if (tab.type === "script") {
                        return (
                          <Tab tabId={tab.id} tabLabel={tab.script.name} key={tab.id}>
                            <Task
                              model={tab.model}
                              onGoToDefinition={onGoToDefinition}
                              onEditorReady={(editor) => onEditorReady(tab.id, editor)}
                              viewState={tab.viewState}
                              onRun={onRunActiveTab}
                              onStop={onStopActiveRun}
                              running={activeRun?.tabId === tab.id}
                              startedAt={activeRun?.tabId === tab.id ? activeRun.startedAt : undefined}
                            />
                          </Tab>
                        );
                      }

                      if (tab.type === "definition") {
                        return (
                          <Tab tabId={tab.id} tabLabel={getTabLabel(tab.model.uri.path)} isEphemeral={true} key="definition">
                            <Definition
                              model={tab.model}
                              onGoToDefinition={onGoToDefinition}
                              startLineNumber={tab.startLineNumber}
                              startColumn={tab.startColumn}
                            />
                          </Tab>
                        );
                      }

                      if (tab.type === "appForm") {
                        return (
                          <Tab tabId={tab.id} tabLabel={getAppFormTabLabel(tab)} icon={getAppFormTabIcon(tab)} isEphemeral={tab.ephemeral} key={tab.id}>
                            <AppForm
                              mode={tab.mode}
                              initialData={tab.initialData}
                              allApps={configuration?.apps ?? []}
                              variables={configuration?.variables ?? {}}
                              readOnly={!(configuration?.system?.canUpdateConfiguration ?? false)}
                              editMode={tab.editMode}
                              onSubmit={onAppFormSubmit}
                              onCancel={onAppFormCancel}
                              onEdited={onAppFormEdited}
                              onJsonValidChange={setAppFormJsonValid}
                            />
                          </Tab>
                        );
                      }

                      if (tab.type === "variables") {
                        return (
                          <Tab tabId={tab.id} tabLabel="Variables" icon={Braces} key={tab.id}>
                            <Variables
                              variables={configuration?.variables ?? {}}
                              status={variableStatus}
                              storeAvailable={configuration?.system?.variableStoreAvailable ?? false}
                              usage={variableUsage}
                              readOnly={!(configuration?.system?.canUpdateConfiguration ?? false)}
                              onSave={onVariablesSave}
                              onDirtyChange={onVariablesDirtyChange}
                            />
                          </Tab>
                        );
                      }

                      throw new Error("Unknown tab type");
                    })}
                  </Tabs>
                </div>
                {isActiveTaskTab && (
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
          gitRef={configuration?.system?.gitRef}
          buildNumber={configuration?.system?.buildNumber}
          featurePreviews={featurePreviews}
          onToggleFeaturePreview={onToggleFeaturePreview}
          mcpInfo={previewMcp ? mcpInfo : undefined}
          apps={apps}
          configurationLoaded={configurationLoaded}
          onShowCompileLog={onShowCompileLog}
          onRecompile={onRecompile}
        />
      </div>
      <SearchPopup isOpen={isSearchOpen} apps={apps} onClose={() => setIsSearchOpen(false)} onSelect={onSearchMethodSelect} />
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
      {discardVariablesIndex !== undefined && (
        <ConfirmationDialog
          title="Discard variable changes?"
          confirmButtonContent="Discard"
          confirmButtonType="danger"
          onClose={(gesture) => {
            const index = discardVariablesIndex;
            setDiscardVariablesIndex(undefined);
            if (gesture === "confirm") {
              variablesDirtyRef.current = false;
              closeTab(index);
            }
          }}
        >
          The Variables tab has unsaved changes.
        </ConfirmationDialog>
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
