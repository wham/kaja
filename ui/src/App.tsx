import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import { BaseStyles, IconButton, ThemeProvider, Tooltip, useResponsiveValue } from "@primer/react";
import { ColumnsIcon, RowsIcon, SidebarCollapseIcon, SidebarExpandIcon } from "@primer/octicons-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { GetStartedBlankslate } from "./GetStartedBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Gutter } from "./Gutter";
import { Kaja, MethodCall } from "./kaja";
import { createProjectRef, getDefaultMethod, Method, Project, Service, updateProjectRef } from "./project";
import { Sidebar } from "./Sidebar";
import { SearchPopup } from "./SearchPopup";
import { StatusBar, ColorMode } from "./StatusBar";
import { ProjectForm } from "./ProjectForm";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { Configuration, ConfigurationProject } from "./server/api";
import { getApiClient } from "./server/connection";
import {
  addDefinitionTab,
  addProjectFormTab,
  addTaskTab,
  getProjectFormTabIndex,
  getProjectFormTabLabel,
  getTabLabel,
  linkTabsToProjects,
  markInteraction,
  PersistedTabState,
  restoreTabs,
  serializeTabs,
  TabModel,
  updateProjectFormTab,
} from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";
import { useConfigurationChanges } from "./useConfigurationChanges";
import { usePersistedState } from "./usePersistedState";
import { getPersistedValue, setPersistedValue } from "./storage";
import { isWailsEnvironment } from "./wails";
import { WindowSetTitle } from "./wailsjs/runtime";

// Helper: Create a new project in pending compilation state
function createPendingProject(config: ConfigurationProject): Project {
  return {
    configuration: config,
    projectRef: createProjectRef(config),
    compilation: { status: "pending", logs: [] },
    services: [],
    clients: {},
    sources: [],
    stub: { serviceInfos: {} },
  };
}

// Helper: Apply rename to a project (remap sources and services)
function applyProjectRename(project: Project, newConfig: ConfigurationProject): Project {
  const originalName = project.configuration.name;
  const remappedSources = remapSourcesToNewName(project.sources, originalName, newConfig.name);
  const remappedServices = project.services.map((service) => ({
    ...service,
    sourcePath: newConfig.name + service.sourcePath.slice(originalName.length),
  }));
  // Update the existing projectRef in place so clients use new values
  updateProjectRef(project.projectRef, newConfig);
  return {
    ...project,
    configuration: newConfig,
    sources: remappedSources,
    services: remappedServices,
  };
}

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [scrollToMethod, setScrollToMethod] = useState<{ method: Method; service: Service; project: Project }>();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIndexRef = useRef(activeTabIndex);
  activeTabIndexRef.current = activeTabIndex;
  const editorRegistryRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());
  const hasTabMemory = useRef(getPersistedValue<PersistedTabState>("tabs") !== undefined);
  const tabsRestoredRef = useRef(restoredState !== null && restoredState.tabs.some((t) => t.type === "task"));

  const onMethodCallUpdate = useCallback((methodCall: MethodCall) => {
    setConsoleItems((consoleItems) => {
      const index = consoleItems.findIndex((item) => item === methodCall);
      if (index > -1) {
        return consoleItems.map((item, i) => (i === index ? { ...methodCall } : item));
      } else {
        return [...consoleItems, methodCall];
      }
    });
  }, []);

  const kajaRef = useRef<Kaja>(null);
  if (!kajaRef.current) {
    kajaRef.current = new Kaja(onMethodCallUpdate);
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

  // Responsive layout: narrow (mobile) allows scrolling, regular/wide (desktop) is fixed
  const isNarrow = useResponsiveValue({ narrow: true, regular: false, wide: false }, false);
  const isDesktopMac = isWailsEnvironment() && navigator.platform.startsWith("Mac");
  const overflow = isNarrow ? "auto" : "hidden";
  const sidebarMinWidth = isNarrow ? 250 : 100;
  const mainMinWidth = isNarrow ? 300 : 0;

  // Dispose Monaco source models for a project
  const disposeMonacoModelsForProject = useCallback((projectName: string) => {
    monaco.editor.getModels().forEach((model) => {
      if (model.uri.path.startsWith("/" + projectName + "/")) {
        model.dispose();
      }
    });
  }, []);

  // Create Monaco source models for a project
  const createMonacoModelsForProject = useCallback((project: Project) => {
    project.sources.forEach((source) => {
      const uri = monaco.Uri.parse("ts:/" + source.path);
      const existingModel = monaco.editor.getModel(uri);
      if (!existingModel) {
        monaco.editor.createModel(source.file.text, "typescript", uri);
      } else {
        existingModel.setValue(source.file.text);
      }
    });
  }, []);

  // Dispose task tabs for given project names, returns filtered tabs
  const disposeTaskTabsForProjects = useCallback((projectNames: Set<string>, prevTabs: TabModel[]): TabModel[] => {
    const newTabs: TabModel[] = [];
    for (const tab of prevTabs) {
      if (tab.type === "task" && projectNames.has(tab.originProject.configuration.name)) {
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

  // Core function: Sync projects state from a new configuration
  // This is the single source of truth for project state changes
  const syncProjectsFromConfiguration = useCallback(
    (newConfiguration: Configuration, prevProjects: Project[]): { updatedProjects: Project[]; removedNames: Set<string>; renames: Map<string, string> } => {
      const updatedProjects: Project[] = [];
      const newConfigByName = new Map(newConfiguration.projects.map((p) => [p.name, p]));
      const prevByName = new Map(prevProjects.map((p) => [p.configuration.name, p]));

      // Find orphans (removed) and newcomers (added)
      const orphans = prevProjects.filter((p) => !newConfigByName.has(p.configuration.name));
      const newcomerConfigs = newConfiguration.projects.filter((p) => !prevByName.has(p.name));

      // Detect renames: match orphans to newcomers by protoDir/url
      const renameMap = new Map<string, Project>(); // newName -> oldProject
      for (const newcomer of newcomerConfigs) {
        const matchingOrphan = orphans.find((orphan) => {
          if (newcomer.useReflection && orphan.configuration.useReflection) {
            return newcomer.url === orphan.configuration.url;
          }
          return newcomer.protoDir === orphan.configuration.protoDir && newcomer.protoDir !== "";
        });
        if (matchingOrphan && !renameMap.has(newcomer.name)) {
          renameMap.set(newcomer.name, matchingOrphan);
          const idx = orphans.indexOf(matchingOrphan);
          if (idx !== -1) orphans.splice(idx, 1);
        }
      }

      // Process each project in the new configuration
      for (const newConfig of newConfiguration.projects) {
        const existingProject = prevByName.get(newConfig.name);
        const renamedFrom = renameMap.get(newConfig.name);

        if (renamedFrom) {
          // Rename: remap sources and services
          disposeMonacoModelsForProject(renamedFrom.configuration.name);
          const renamedProject = applyProjectRename(renamedFrom, newConfig);
          createMonacoModelsForProject(renamedProject);
          updatedProjects.push(renamedProject);
          continue;
        }

        if (!existingProject) {
          // New project
          updatedProjects.push(createPendingProject(newConfig));
          continue;
        }

        const prev = existingProject.configuration;
        const protoDirChanged = prev.protoDir !== newConfig.protoDir;
        const useReflectionChanged = prev.useReflection !== newConfig.useReflection;

        if (protoDirChanged || useReflectionChanged) {
          // Needs recompilation
          disposeMonacoModelsForProject(existingProject.configuration.name);
          updatedProjects.push(createPendingProject(newConfig));
        } else {
          // Update the projectRef in place - clients will pick up new URL/headers dynamically
          updateProjectRef(existingProject.projectRef, newConfig);
          updatedProjects.push({ ...existingProject, configuration: newConfig });
        }
      }

      // Clean up removed projects
      const removedNames = new Set(orphans.map((p) => p.configuration.name));
      for (const orphan of orphans) {
        disposeMonacoModelsForProject(orphan.configuration.name);
      }

      // Build renames: oldName -> newName
      const renames = new Map<string, string>();
      for (const [newName, oldProject] of renameMap) {
        renames.set(oldProject.configuration.name, newName);
      }

      return { updatedProjects, removedNames, renames };
    },
    [disposeMonacoModelsForProject, createMonacoModelsForProject],
  );

  // Apply configuration and sync all state
  const applyConfiguration = useCallback(
    (newConfiguration: Configuration) => {
      setConfiguration(newConfiguration);

      setProjects((prevProjects) => {
        const { updatedProjects, removedNames, renames } = syncProjectsFromConfiguration(newConfiguration, prevProjects);

        // Clean up task tabs for removed projects
        if (removedNames.size > 0) {
          setTabs((prevTabs) => {
            const newTabs = disposeTaskTabsForProjects(removedNames, prevTabs);
            if (updatedProjects.length === 0 && !newTabs.some((t) => t.type === "compiler")) {
              setSelectedMethod(undefined);
              setActiveTabIndex(0);
              return [{ type: "compiler" as const }];
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

        return updatedProjects;
      });
    },
    [syncProjectsFromConfiguration, disposeTaskTabsForProjects],
  );

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
    if (tabs.length === 0 && projects.length === 0) {
      setTabs([{ type: "compiler" }]);
    } else if (projects.length === 0 && !tabs.some((t) => t.type === "compiler")) {
      setTabs((prevTabs) => {
        if (prevTabs.some((t) => t.type === "compiler")) return prevTabs;
        return [...prevTabs, { type: "compiler" }];
      });
    }
  }, [tabs.length, projects.length]);

  useEffect(() => {
    monaco.editor.setTheme(colorMode === "night" ? "vs-dark" : "vs");
    document.body.style.backgroundColor = colorMode === "night" ? "#0d1117" : "#ffffff";
  }, [colorMode]);

  useEffect(() => {
    const activeTab = tabs[activeTabIndex];
    let title = "Kaja";
    if (activeTab?.type === "task" && activeTab.originProject) {
      title = `${activeTab.originProject.configuration.name} - Kaja`;
    }
    document.title = title;
    if (isWailsEnvironment()) {
      WindowSetTitle(title);
    }
  }, [tabs, activeTabIndex]);

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
    const handler = () => persistTabs();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persistTabs]);

  const onCompilationUpdate = (updatedProjects: Project[] | ((prev: Project[]) => Project[])) => {
    // Handle both direct array and functional updates
    if (typeof updatedProjects === "function") {
      setProjects((prevProjects) => {
        const newProjects = updatedProjects(prevProjects);
        handlePostCompilationLogic(newProjects);
        return newProjects;
      });
    } else {
      setProjects(updatedProjects);
      handlePostCompilationLogic(updatedProjects);
    }
  };

  const handlePostCompilationLogic = (updatedProjects: Project[]) => {
    // Check if all projects have finished compiling successfully
    const allCompiled = updatedProjects.every((p) => p.compilation.status === "success");
    if (allCompiled && updatedProjects.length > 0 && updatedProjects[0].services.length > 0) {
      updatedProjects.forEach((project) => {
        if (project.sources) {
          project.sources.forEach((source) => {
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

      if (updatedProjects.length === 0) {
        return;
      }

      // If tabs were restored from persisted state, link them to compiled projects
      if (tabsRestoredRef.current) {
        tabsRestoredRef.current = false;
        setTabs((prevTabs) => {
          linkTabsToProjects(prevTabs, updatedProjects);
          const activeTab = prevTabs[activeTabIndexRef.current];
          if (activeTab?.type === "task") {
            setSelectedMethod(activeTab.originMethod);
          }
          return [...prevTabs];
        });
        return;
      }

      // Only auto-open the first method on first-time use (no previous tab memory)
      if (!hasTabMemory.current) {
        const defaultMethodAndService = getDefaultMethod(updatedProjects[0].services);
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
          const result = addTaskTab([], defaultMethodAndService.method, defaultMethodAndService.service, updatedProjects[0]);
          setActiveTabIndex(result.activeIndex);
          return result.tabs;
        });
      }
    }
  };

  const onMethodSelect = (method: Method, service: Service, project: Project) => {
    captureActiveViewState();
    setSelectedMethod(method);
    setTabs((tabs) => {
      const result = addTaskTab(tabs, method, service, project);
      setActiveTabIndex(result.activeIndex);
      return result.tabs;
    });
    persistTabs();
  };

  const onSearchMethodSelect = (method: Method, service: Service, project: Project) => {
    onMethodSelect(method, service, project);
    setScrollToMethod({ method, service, project });
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

  const onCloseTab = (index: number) => {
    setTabs((prevTabs) => {
      const tab = prevTabs[index];
      if (tab?.type === "task") {
        editorRegistryRef.current.delete(tab.id);
        tab.model.dispose();
      }
      const newTabs = prevTabs.filter((_, i) => i !== index);
      const newActiveIndex = index === activeTabIndex ? Math.max(0, newTabs.length - 1) : index < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
    });
    persistTabs();
  };

  const onCloseAll = () => {
    setTabs((prevTabs) => {
      prevTabs.forEach((tab) => {
        if (tab.type === "task") {
          editorRegistryRef.current.delete(tab.id);
          tab.model.dispose();
        }
      });
      setActiveTabIndex(0);
      return [];
    });
    persistTabs();
  };

  const onCloseOthers = (keepIndex: number) => {
    setTabs((prevTabs) => {
      prevTabs.forEach((tab, i) => {
        if (i !== keepIndex && tab.type === "task") {
          editorRegistryRef.current.delete(tab.id);
          tab.model.dispose();
        }
      });
      setActiveTabIndex(0);
      return prevTabs.filter((_, i) => i === keepIndex);
    });
    persistTabs();
  };

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
  };

  const onNewProjectClick = () => {
    setTabs((tabs) => {
      const newTabs = addProjectFormTab(tabs, "create");
      const formIndex = getProjectFormTabIndex(newTabs);
      setActiveTabIndex(formIndex);
      return newTabs;
    });
  };

  const onEditProject = (projectName: string) => {
    const project = projects.find((p) => p.configuration.name === projectName);
    if (project) {
      setTabs((tabs) => {
        const newTabs = addProjectFormTab(tabs, "edit", project.configuration);
        const formIndex = getProjectFormTabIndex(newTabs);
        setActiveTabIndex(formIndex);
        return newTabs;
      });
    }
  };

  const closeProjectFormTab = () => {
    setTabs((prevTabs) => {
      const formIndex = getProjectFormTabIndex(prevTabs);
      if (formIndex === -1) return prevTabs;
      const newTabs = prevTabs.filter((_, i) => i !== formIndex);
      const newActiveIndex = formIndex === activeTabIndex ? Math.max(0, newTabs.length - 1) : formIndex < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
    });
  };

  const onProjectFormSubmit = async (project: ConfigurationProject, originalName?: string) => {
    closeProjectFormTab();

    if (!configuration) {
      return;
    }

    const isEdit = originalName !== undefined;
    const needsRecompilation =
      isEdit &&
      (() => {
        const originalProject = projects.find((p) => p.configuration.name === originalName);
        if (!originalProject) return false;
        return originalProject.configuration.protoDir !== project.protoDir || originalProject.configuration.useReflection !== project.useReflection;
      })();
    const isNewProject = !isEdit;

    // Update configuration
    const updatedConfiguration: Configuration = {
      ...configuration,
      projects: isEdit ? configuration.projects.map((p) => (p.name === originalName ? project : p)) : [...configuration.projects, project],
    };

    // Save configuration via API and apply changes through unified path
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      applyConfiguration(response.configuration);
    }

    // Show compiler tab for new projects or when recompilation is needed
    if (isNewProject || needsRecompilation) {
      onCompilerClick();
    }
  };

  const onProjectFormCancel = () => {
    closeProjectFormTab();
  };

  const onProjectFormSelect = (projectName: string | null) => {
    if (projectName === null) {
      // Switch to new project mode
      setTabs((tabs) => updateProjectFormTab(tabs, "create"));
    } else {
      // Switch to edit mode for the selected project
      const project = projects.find((p) => p.configuration.name === projectName);
      if (project) {
        setTabs((tabs) => updateProjectFormTab(tabs, "edit", project.configuration));
      }
    }
  };

  const onDeleteProject = async (projectName: string) => {
    if (!configuration) {
      return;
    }

    // Update configuration to remove the project
    const updatedConfiguration: Configuration = {
      ...configuration,
      projects: configuration.projects.filter((p) => p.name !== projectName),
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

  const isActiveTaskTab = tabs[activeTabIndex]?.type === "task";
  const isHorizontalLayout = editorLayout === "horizontal" && isActiveTaskTab;

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
                {isDesktopMac && <div style={{ height: 28, flexShrink: 0, "--wails-draggable": "drag" } as React.CSSProperties} />}
                <Sidebar
                  projects={projects}
                  canDeleteProjects={configuration?.system?.canUpdateConfiguration ?? false}
                  onSelect={onMethodSelect}
                  currentMethod={selectedMethod}
                  scrollToMethod={scrollToMethod}
                  onCompilerClick={onCompilerClick}
                  onNewProjectClick={onNewProjectClick}
                  onEditProject={onEditProject}
                  onDeleteProject={onDeleteProject}
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
                <div
                  onClick={() => setIsSearchOpen(true)}
                  style={
                    {
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
                      "--wails-draggable": "no-drag",
                    } as React.CSSProperties
                  }
                >
                  {navigator.platform.startsWith("Mac") ? "⌘K" : "Ctrl+K"} to search
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
                  <Tooltip text={sidebarCollapsed ? `Show sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)` : `Hide sidebar (${navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"}B)`} direction="s">
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
              {tabs.length === 0 && <GetStartedBlankslate />}
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
                    >
                      {tabs.map((tab, index) => {
                        if (tab.type === "compiler") {
                          return (
                            <Tab tabId="compiler" tabLabel="Compiler" key="compiler">
                              <Compiler
                                projects={projects}
                                onUpdate={onCompilationUpdate}
                                onConfigurationLoaded={setConfiguration}
                                onNewProjectClick={onNewProjectClick}
                              />
                            </Tab>
                          );
                        }

                        if (tab.type === "task") {
                          return (
                            <Tab tabId={tab.id} tabLabel={tab.originMethod.name} isEphemeral={!tab.hasInteraction && index === tabs.length - 1} key="task">
                              <Task
                                model={tab.model}
                                projects={projects}
                                kaja={kajaRef.current!}
                                onInteraction={() => {
                                  setTabs((tabs) => markInteraction(tabs, index));
                                  persistTabs();
                                }}
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

                        if (tab.type === "projectForm") {
                          const label = getProjectFormTabLabel(tab);
                          return (
                            <Tab tabId={tab.id} tabLabel={label} key={tab.id}>
                              <ProjectForm
                                mode={tab.mode}
                                initialData={tab.initialData}
                                allProjects={configuration?.projects ?? []}
                                readOnly={!(configuration?.system?.canUpdateConfiguration ?? false)}
                                onSubmit={onProjectFormSubmit}
                                onCancel={onProjectFormCancel}
                                onProjectSelect={onProjectFormSelect}
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
          <StatusBar colorMode={colorMode} onToggleColorMode={onToggleColorMode} gitRef={configuration?.system?.gitRef} />
        </div>
        <SearchPopup isOpen={isSearchOpen} projects={projects} onClose={() => setIsSearchOpen(false)} onSelect={onSearchMethodSelect} />
      </BaseStyles>
    </ThemeProvider>
  );
}
