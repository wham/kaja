import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import { BaseStyles, ThemeProvider, useResponsiveValue } from "@primer/react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerAIProvider } from "./ai";
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
import { addDefinitionTab, addProjectFormTab, addTaskTab, getProjectFormTabIndex, getProjectFormTabLabel, getTabLabel, markInteraction, TabModel, updateProjectFormTab } from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";
import { useConfigurationChanges } from "./useConfigurationChanges";
import { usePersistedState } from "./usePersistedState";
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
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = usePersistedState("sidebarWidth", 300);
  const [editorHeight, setEditorHeight] = usePersistedState("editorHeight", 400);
  const [colorMode, setColorMode] = usePersistedState<ColorMode>("colorMode", "night");
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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

  const onToggleColorMode = useCallback(() => {
    setColorMode((mode) => (mode === "night" ? "day" : "night"));
  }, []);

  // Responsive layout: narrow (mobile) allows scrolling, regular/wide (desktop) is fixed
  const isNarrow = useResponsiveValue({ narrow: true, regular: false, wide: false }, false);
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

  // Core function: Sync projects state from a new configuration
  // This is the single source of truth for project state changes
  const syncProjectsFromConfiguration = useCallback((
    newConfiguration: Configuration,
    prevProjects: Project[]
  ): { updatedProjects: Project[]; removedNames: Set<string>; renames: Map<string, string> } => {
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
  }, [disposeMonacoModelsForProject, createMonacoModelsForProject]);

  // Apply configuration and sync all state
  const applyConfiguration = useCallback((newConfiguration: Configuration) => {
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
        registerAIProvider(updatedProjects);
      }

      return updatedProjects;
    });
  }, [syncProjectsFromConfiguration, disposeTaskTabsForProjects]);

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

  // Global "/" keyboard shortcut to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      registerAIProvider(updatedProjects);

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

      const defaultMethodAndService = getDefaultMethod(updatedProjects[0].services);
      setSelectedMethod(defaultMethodAndService?.method);

      if (!defaultMethodAndService) {
        return;
      }

      setTabs((prevTabs) => {
        // Dispose old task models before replacing
        prevTabs.forEach((tab) => {
          if (tab.type === "task") {
            tab.model.dispose();
          }
        });
        return addTaskTab([], defaultMethodAndService.method, defaultMethodAndService.service, updatedProjects[0]);
      });
      setActiveTabIndex(0);
    }
  };

  const onMethodSelect = (method: Method, service: Service, project: Project) => {
    setSelectedMethod(method);
    setTabs((tabs) => {
      tabs = addTaskTab(tabs, method, service, project);
      setActiveTabIndex(tabs.length - 1);
      return tabs;
    });
  };

  const onGoToDefinition = (model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number) => {
    setTabs((tabs) => {
      tabs = addDefinitionTab(tabs, model, startLineNumber, startColumn);
      setActiveTabIndex(tabs.length - 1);
      return tabs;
    });
  };

  const onSidebarResize = (delta: number) => {
    setSidebarWidth((width) => width + delta);
  };

  const onSelectTab = (index: number) => {
    setActiveTabIndex(index);
  };

  const onCloseTab = (index: number) => {
    setTabs((prevTabs) => {
      const tab = prevTabs[index];
      if (tab?.type === "task") {
        tab.model.dispose();
      }
      const newTabs = prevTabs.filter((_, i) => i !== index);
      const newActiveIndex = index === activeTabIndex ? Math.max(0, newTabs.length - 1) : index < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;
      setActiveTabIndex(newActiveIndex);
      return newTabs;
    });
  };

  const onCloseAll = () => {
    setTabs((prevTabs) => {
      prevTabs.forEach((tab) => {
        if (tab.type === "task") {
          tab.model.dispose();
        }
      });
      setActiveTabIndex(0);
      return [];
    });
  };

  const onCloseOthers = (keepIndex: number) => {
    setTabs((prevTabs) => {
      prevTabs.forEach((tab, i) => {
        if (i !== keepIndex && tab.type === "task") {
          tab.model.dispose();
        }
      });
      setActiveTabIndex(0);
      return prevTabs.filter((_, i) => i === keepIndex);
    });
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
    const needsRecompilation = isEdit && (() => {
      const originalProject = projects.find((p) => p.configuration.name === originalName);
      if (!originalProject) return false;
      return originalProject.configuration.protoDir !== project.protoDir ||
             originalProject.configuration.useReflection !== project.useReflection;
    })();
    const isNewProject = !isEdit;

    // Update configuration
    const updatedConfiguration: Configuration = {
      ...configuration,
      projects: isEdit
        ? configuration.projects.map((p) => (p.name === originalName ? project : p))
        : [...configuration.projects, project],
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

  return (
    <ThemeProvider colorMode={colorMode}>
      <BaseStyles>
        <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", overflow, background: "var(--bgColor-default)", WebkitOverflowScrolling: isNarrow ? "touch" : undefined, overscrollBehavior: isNarrow ? "contain" : "none" }}>
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{ width: isNarrow ? 250 : sidebarWidth, minWidth: sidebarMinWidth, maxWidth: 600, display: "flex", flexShrink: 0 }}>
            <Sidebar
              projects={projects}
              canDeleteProjects={configuration?.system?.canUpdateConfiguration ?? false}
              onSelect={onMethodSelect}
              currentMethod={selectedMethod}
              onCompilerClick={onCompilerClick}
              onNewProjectClick={onNewProjectClick}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
              onSearchClick={() => setIsSearchOpen(true)}
            />
          </div>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: mainMinWidth, minHeight: 0 }}>
            {tabs.length === 0 && <GetStartedBlankslate />}
            {tabs.length > 0 && (
              <>
                <div style={{ height: tabs[activeTabIndex]?.type === "task" ? editorHeight : undefined, flex: tabs[activeTabIndex]?.type === "task" ? undefined : 1, display: "flex", flexDirection: "column", minHeight: 0, flexShrink: 0 }}>
                  <Tabs activeTabIndex={activeTabIndex} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onCloseAll={onCloseAll} onCloseOthers={onCloseOthers}>
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

                      if (tab.type === "task" && projects.length > 0) {
                        return (
                          <Tab tabId={tab.id} tabLabel={tab.originMethod.name} isEphemeral={!tab.hasInteraction && index === tabs.length - 1} key="task">
                            <Task
                              model={tab.model}
                              projects={projects}
                              kaja={kajaRef.current!}
                              onInteraction={() => setTabs((tabs) => markInteraction(tabs, index))}
                              onGoToDefinition={onGoToDefinition}
                            />
                          </Tab>
                        );
                      }

                      if (tab.type === "definition") {
                        return (
                          <Tab tabId={tab.id} tabLabel={getTabLabel(tab.model.uri.path)} isEphemeral={true} key="definition">
                            <Definition model={tab.model} onGoToDefinition={onGoToDefinition} startLineNumber={tab.startLineNumber} startColumn={tab.startColumn} />
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
                {tabs[activeTabIndex]?.type === "task" && (
                  <>
                    <Gutter orientation="horizontal" onResize={onEditorResize} />
                    <div style={{ flex: 1, minHeight: 100, display: "flex", flexDirection: "column" }}>
                      <Console items={consoleItems} onClear={onClearConsole} colorMode={colorMode} />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          </div>
          <StatusBar colorMode={colorMode} onToggleColorMode={onToggleColorMode} />
        </div>
        <SearchPopup
          isOpen={isSearchOpen}
          projects={projects}
          onClose={() => setIsSearchOpen(false)}
          onSelect={onMethodSelect}
        />
      </BaseStyles>
    </ThemeProvider>
  );
}
