import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import {
  BaseStyles,
  Button,
  ConfirmationDialog,
  Dialog,
  Flash,
  FormControl,
  IconButton,
  TextInput,
  ThemeProvider,
  Tooltip,
  useResponsiveValue,
} from "@primer/react";
import { ColumnsIcon, CommentDiscussionIcon, RowsIcon, SidebarCollapseIcon, SidebarExpandIcon } from "@primer/octicons-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { GetStartedBlankslate } from "./GetStartedBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Gutter } from "./Gutter";
import { AskCancelledError, Kaja, MethodCall } from "./kaja";
import { appParameters, appType, buildApp } from "./appTypes";
import { createPendingApp, createAppRef, getDefaultMethod, Method, App as AppModel, Script, Service, Transport, updateAppRef } from "./apps";
import { Sidebar } from "./Sidebar";
import { NewAppDialog } from "./NewAppDialog";
import { SearchPopup } from "./SearchPopup";
import { StatusBar, ColorMode } from "./StatusBar";
import { FeaturePreview } from "./FeaturePreviews";
import { AppForm } from "./AppForm";
import { registerKajaGlobals } from "./Editor";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { Configuration, ConfigurationApp } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  addDefinitionTab,
  addAppFormTab,
  addScriptTab,
  addTaskTab,
  addVariablesTab,
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
  updateAppFormTab,
} from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Variables } from "./Variables";
import { Task } from "./Task";
import { useCompilation } from "./useCompilation";
import { useConfigurationChanges } from "./useConfigurationChanges";
import { usePersistedState } from "./usePersistedState";
import { setVariables, variableReferences } from "./variableExpansion";
import { flushPersistedWrites, getPersistedValue, setPersistedValue } from "./storage";
import { FirstAppBlankslate } from "./FirstAppBlankslate";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL, EventsEmit, EventsOn, WindowSetTitle } from "./wailsjs/runtime";
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
  WriteScriptFile,
} from "./wailsjs/go/main/App";
import { main } from "./wailsjs/go/models";
import { runTask, runTaskCaptured } from "./taskRunner";

// Maximum number of console items kept in memory; older calls are dropped.
const MAX_CONSOLE_ITEMS = 500;

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
  const [editorWidth, setEditorWidth] = usePersistedState("editorWidth", 600);
  const [editorLayout, setEditorLayout] = usePersistedState<"vertical" | "horizontal">("editorLayout", "vertical");
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
  // One-shot signal to auto-expand a just-added app in the sidebar.
  const [autoExpandApp, setAutoExpandApp] = useState<{ name: string }>();
  // Rename dialog and delete confirmation for scripts (right-click menu).
  const [renameScript, setRenameScript] = useState<{ script: Script; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string>();
  const [deleteScript, setDeleteScript] = useState<Script | null>(null);
  // Path of the script pinned to the macOS "Run Kaja Script" text service.
  const [pinnedScriptPath, setPinnedScriptPath] = useState<string | undefined>(() => getPersistedValue<string>("contextMenuScriptPath"));
  // Pending debounced disk writes for open script tabs, keyed by tab id.
  const scriptSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

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

  const onEditorResize = useCallback((delta: number) => {
    setEditorHeight((height) => Math.max(100, height + delta));
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
  const isNarrow = useResponsiveValue({ narrow: true, regular: false, wide: false }, false);
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
    if (kajaRef.current) {
      kajaRef.current.variables = variables;
    }
    registerKajaGlobals(Object.keys(variables));
  }, [configuration?.variables]);

  // Handle external configuration file changes (hot reload)
  const handleConfigurationFileChange = useCallback(async () => {
    const client = getApiClient();
    const { response } = await client.getConfiguration({});
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
  }, [applyConfiguration]);

  useConfigurationChanges(handleConfigurationFileChange);

  useEffect(() => {
    monaco.editor.setTheme(colorMode === "night" ? "vs-dark" : "vs");
    document.body.style.backgroundColor = colorMode === "night" ? "#0d1117" : "#ffffff";
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

    // Check if all apps have finished compiling successfully
    const allCompiled = updatedApps.every((p) => p.compilation.status === "success");
    if (allCompiled && updatedApps.length > 0 && updatedApps[0].services.length > 0) {
      updatedApps.forEach((app) => {
        if (app.sources) {
          app.sources.forEach((source) => {
            const uri = monaco.Uri.parse("ts:/" + source.path);
            const existingModel = monaco.editor.getModel(uri);
            if (!existingModel) {
              monaco.editor.createModel(source.file.text, "typescript", uri);
            } else {
              existingModel.setValue(source.file.text);
            }
          });
        }
      });

      if (updatedApps.length === 0) {
        return;
      }

      // If tabs were restored from persisted state, link them to compiled apps
      if (tabsRestoredRef.current) {
        tabsRestoredRef.current = false;
        setTabs((prevTabs) => {
          linkTabsToApps(prevTabs, updatedApps);
          const activeTab = prevTabs[activeTabIndexRef.current];
          if (activeTab?.type === "task") {
            setSelectedMethod(activeTab.originMethod);
          }
          return [...prevTabs];
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

  const { configurationLoaded } = useCompilation(apps, onCompilationUpdate, setConfiguration);

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
        runTask(file.content, kaja, apps);
      } catch (err) {
        showFileError(`Run failed: ${err}`);
      }
    },
    [pinnedScriptPath, onScriptSelect, apps, showFileError],
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
      const renamed: Script = { path: file.path, name: file.name };
      setScripts((prev) => (prev ?? []).map((s) => (s.path === original.path ? renamed : s)).sort((a, b) => a.name.localeCompare(b.name)));
      // Re-point any open tab for this script at the new path/name.
      setTabs((prev) => prev.map((t) => (t.type === "script" && t.script.path === original.path ? { ...t, script: renamed } : t)));
      // Keep the context-menu pin pointing at the renamed file.
      setPinnedScriptPath((current) => (current === original.path ? renamed.path : current));
      persistTabs();
      setRenameScript(null);
      setRenameError(undefined);
    } catch (err) {
      setRenameError(String(err));
    }
  }, [renameScript, persistTabs]);

  // Right-click → Delete: confirm, then remove the file and close its tab.
  const onConfirmDeleteScript = useCallback(
    async (script: Script) => {
      try {
        await DeleteScript(script.path);
      } catch (err) {
        showFileError(`Delete failed: ${err}`);
        return;
      }
      setScripts((prev) => (prev ?? []).filter((s) => s.path !== script.path));
      // Drop the context-menu pin if it pointed at the deleted script.
      setPinnedScriptPath((current) => (current === script.path ? undefined : current));
      setTabs((prevTabs) => {
        const idx = prevTabs.findIndex((t) => t.type === "script" && t.script.path === script.path);
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
    [showFileError, persistTabs],
  );

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

  const disposeTabEditor = (tab: TabModel) => {
    if (tab.type === "task" || tab.type === "script") {
      flushScriptTab(tab);
      editorRegistryRef.current.delete(tab.id);
      tab.model.dispose();
    }
  };

  const onCloseTab = (index: number) => {
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

  // Run the active task/script tab's editor contents. Triggered by the docked
  // Run button in the tab strip and by F5.
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
    runTask(editor.getValue(), kajaRef.current!, apps);
    if (tab.type === "task") {
      setTabs((tabs) => markInteraction(tabs, index));
      persistTabs();
    }
  }, [apps, persistTabs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        onRunActiveTab();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRunActiveTab]);

  const onCompilerClick = () => {
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

  const onNewAppClick = () => {
    setNewAppOpen(true);
  };

  // Picking a type in the New dialog opens the create form tab for that type. The
  // type is fixed at creation and not editable in the form afterwards.
  const onSelectAppType = (type: string) => {
    setNewAppOpen(false);
    setTabs((tabs) => {
      const newTabs = addAppFormTab(tabs, "create", buildApp("", type, {}, {}));
      const formIndex = getAppFormTabIndex(newTabs);
      setActiveTabIndex(formIndex);
      return newTabs;
    });
  };

  const onEditApp = (appName: string) => {
    const app = apps.find((p) => p.configuration.name === appName);
    if (app) {
      setTabs((tabs) => {
        const newTabs = addAppFormTab(tabs, "edit", app.configuration);
        const formIndex = getAppFormTabIndex(newTabs);
        setActiveTabIndex(formIndex);
        return newTabs;
      });
    }
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
    const needsRecompilation =
      isEdit &&
      (() => {
        const originalApp = apps.find((p) => p.configuration.name === originalName);
        if (!originalApp) return false;
        return appNeedsRecompile(originalApp.configuration, app);
      })();
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

    // Show compiler tab for new apps or when recompilation is needed
    if (isNewApp || needsRecompilation) {
      onCompilerClick();
    }

    if (isNewApp) {
      setAutoExpandApp({ name: app.name });
    }
  };

  const onAppFormCancel = () => {
    closeAppFormTab();
  };

  const onVariablesClick = () => {
    setTabs((tabs) => {
      const { tabs: newTabs, activeIndex } = addVariablesTab(tabs);
      setActiveTabIndex(activeIndex);
      return newTabs;
    });
  };

  const closeVariablesTab = () => {
    setTabs((prevTabs) => {
      const index = getVariablesTabIndex(prevTabs);
      if (index === -1) return prevTabs;
      const newTabs = prevTabs.filter((_, i) => i !== index);
      const newActiveIndex = index === activeTabIndex ? Math.max(0, newTabs.length - 1) : index < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
    });
  };

  const onVariablesSubmit = async (variables: { [key: string]: string }) => {
    closeVariablesTab();

    if (!configuration) {
      return;
    }

    const updatedConfiguration: Configuration = { ...configuration, variables };
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }
  };

  const onVariablesCancel = () => {
    closeVariablesTab();
  };

  const onAppFormSelect = (appName: string | null) => {
    if (appName === null) {
      // "+ New" reopens the type picker, since the type is chosen there.
      setNewAppOpen(true);
    } else {
      // Switch to edit mode for the selected app
      const app = apps.find((p) => p.configuration.name === appName);
      if (app) {
        setTabs((tabs) => updateAppFormTab(tabs, "edit", app.configuration));
      }
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

  const activeTab = tabs[activeTabIndex];
  const isActiveTaskTab = activeTab?.type === "task" || activeTab?.type === "script";
  const isHorizontalLayout = editorLayout === "horizontal" && isActiveTaskTab;
  const activeScriptPath = activeTab?.type === "script" ? activeTab.script.path : undefined;

  return (
    <ThemeProvider colorMode={colorMode}>
      <BaseStyles>
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            overflow,
            background: "var(--bgColor-default)",
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
                  onCompilerClick={onCompilerClick}
                  onNewAppClick={onNewAppClick}
                  onVariablesClick={previewScripts ? onVariablesClick : undefined}
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
                style={
                  {
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid var(--borderColor-muted)",
                    background: "var(--bgColor-default)",
                    flexShrink: 0,
                    "--wails-draggable": "drag",
                  } as React.CSSProperties
                }
              >
                <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, "--wails-draggable": "no-drag" } as React.CSSProperties}>
                  <div
                    onClick={() => setIsSearchOpen(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "2px 12px",
                      fontSize: 12,
                      color: "var(--fgColor-muted)",
                      backgroundColor: "var(--bgColor-muted)",
                      border: "1px solid var(--borderColor-default)",
                      borderRadius: 6,
                      cursor: "pointer",
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    {navigator.platform.startsWith("Mac") ? "⌘K" : "Ctrl+K"} to search
                  </div>
                  <Button
                    leadingVisual={CommentDiscussionIcon}
                    variant="invisible"
                    size="small"
                    onClick={() => {
                      const url = "https://github.com/wham/kaja/issues/new?template=feedback.yml";
                      if (isWailsEnvironment()) {
                        BrowserOpenURL(url);
                      } else {
                        window.open(url, "_blank");
                      }
                    }}
                    style={{ color: "var(--fgColor-muted)", fontSize: 12 }}
                  >
                    Feedback
                  </Button>
                </div>
                <div
                  style={
                    {
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      justifyContent: "flex-end",
                      paddingRight: 8,
                      gap: 2,
                      "--wails-draggable": "no-drag",
                    } as React.CSSProperties
                  }
                >
                  <Tooltip
                    text={
                      sidebarCollapsed
                        ? `Show sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)`
                        : `Hide sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)`
                    }
                    direction="s"
                  >
                    <IconButton
                      icon={sidebarCollapsed ? SidebarCollapseIcon : SidebarExpandIcon}
                      aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                      onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                      size="small"
                      variant="invisible"
                    />
                  </Tooltip>
                  <Tooltip text={editorLayout === "vertical" ? "Side-by-side layout" : "Top-bottom layout"} direction="s">
                    <IconButton
                      icon={editorLayout === "vertical" ? ColumnsIcon : RowsIcon}
                      aria-label={editorLayout === "vertical" ? "Switch to side-by-side layout" : "Switch to top-bottom layout"}
                      onClick={onToggleEditorLayout}
                      size="small"
                      variant="invisible"
                    />
                  </Tooltip>
                </div>
              </div>
              {tabs.length === 0 && configurationLoaded && apps.length === 0 && <FirstAppBlankslate onNewAppClick={onNewAppClick} />}
              {tabs.length === 0 && (apps.length > 0 || !configurationLoaded) && <GetStartedBlankslate />}
              {tabs.length > 0 && (
                <div style={{ flex: 1, display: "flex", flexDirection: isHorizontalLayout ? "row" : "column", minHeight: 0 }}>
                  <div
                    style={{
                      height: isActiveTaskTab && !isHorizontalLayout ? editorHeight : undefined,
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
                      onRun={isActiveTaskTab ? onRunActiveTab : undefined}
                    >
                      {tabs.map((tab, index) => {
                        if (tab.type === "compiler") {
                          return (
                            <Tab tabId="compiler" tabLabel="Compiler" key="compiler">
                              <Compiler apps={apps} configurationLoaded={configurationLoaded} onNewAppClick={onNewAppClick} />
                            </Tab>
                          );
                        }

                        if (tab.type === "task") {
                          return (
                            <Tab tabId={tab.id} tabLabel={tab.originMethod.name} isEphemeral={!tab.hasInteraction && index === tabs.length - 1} key="task">
                              <Task
                                model={tab.model}
                                onGoToDefinition={onGoToDefinition}
                                onEditorReady={(editor) => editorRegistryRef.current.set(tab.id, editor)}
                                viewState={tab.viewState}
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
                                onEditorReady={(editor) => editorRegistryRef.current.set(tab.id, editor)}
                                viewState={tab.viewState}
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
                          const label = getAppFormTabLabel(tab);
                          return (
                            <Tab tabId={tab.id} tabLabel={label} key={tab.id}>
                              <AppForm
                                mode={tab.mode}
                                initialData={tab.initialData}
                                allApps={configuration?.apps ?? []}
                                variables={configuration?.variables ?? {}}
                                readOnly={!(configuration?.system?.canUpdateConfiguration ?? false)}
                                onSubmit={onAppFormSubmit}
                                onCancel={onAppFormCancel}
                                onAppSelect={onAppFormSelect}
                              />
                            </Tab>
                          );
                        }

                        if (tab.type === "variables") {
                          return (
                            <Tab tabId={tab.id} tabLabel="Variables" key={tab.id}>
                              <Variables
                                variables={configuration?.variables ?? {}}
                                readOnly={!(configuration?.system?.canUpdateConfiguration ?? false)}
                                onSubmit={onVariablesSubmit}
                                onCancel={onVariablesCancel}
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
                      <Gutter
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
                        <Console items={consoleItems} onClear={onClearConsole} colorMode={colorMode} />
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
          />
        </div>
        <SearchPopup isOpen={isSearchOpen} apps={apps} onClose={() => setIsSearchOpen(false)} onSelect={onSearchMethodSelect} />
        {saveAs && (
          <Dialog
            title="Save as script"
            width="medium"
            onClose={() => {
              setSaveAs(null);
              setSaveAsError(undefined);
            }}
            footerButtons={[
              { content: "Cancel", onClick: () => setSaveAs(null) },
              { content: "Save", buttonType: "primary", onClick: onConfirmSaveAsScript },
            ]}
          >
            <FormControl>
              <FormControl.Label>Name</FormControl.Label>
              <TextInput
                block
                autoFocus
                trailingVisual=".ts"
                value={saveAs.name}
                onChange={(e) => setSaveAs((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmSaveAsScript();
                  }
                }}
              />
              {saveAsError && <FormControl.Validation variant="error">{saveAsError}</FormControl.Validation>}
            </FormControl>
          </Dialog>
        )}
        {askPrompt && (
          <Dialog
            title="Input"
            width="medium"
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
                buttonType: "primary",
                onClick: () => {
                  askPrompt.resolve(askPrompt.value);
                  setAskPrompt(null);
                },
              },
            ]}
          >
            <FormControl>
              <FormControl.Label>{askPrompt.message}</FormControl.Label>
              <TextInput
                block
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
            width="medium"
            onClose={() => {
              setRenameScript(null);
              setRenameError(undefined);
            }}
            footerButtons={[
              { content: "Cancel", onClick: () => setRenameScript(null) },
              { content: "Rename", buttonType: "primary", onClick: onConfirmRenameScript },
            ]}
          >
            <FormControl>
              <FormControl.Label>Name</FormControl.Label>
              <TextInput
                block
                autoFocus
                trailingVisual=".ts"
                value={renameScript.name}
                onChange={(e) => setRenameScript((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmRenameScript();
                  }
                }}
              />
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
        {fileError && (
          <div style={{ position: "fixed", top: 36, left: "50%", transform: "translateX(-50%)", zIndex: 1000, maxWidth: 640 }}>
            <Flash variant="danger">{fileError}</Flash>
          </div>
        )}
      </BaseStyles>
    </ThemeProvider>
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
