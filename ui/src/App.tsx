import "@primer/primitives/dist/css/functional/themes/dark.css";
import { BaseStyles, ThemeProvider, useResponsiveValue } from "@primer/react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { registerAIProvider } from "./ai";
import { GetStartedBlankslate } from "./GetStartedBlankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Gutter } from "./Gutter";
import { getDefaultMethod, Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { ProjectForm } from "./ProjectForm";
import { remapEditorCode, remapSourcesToNewName } from "./sources";
import { createClients } from "./projectLoader";
import { Configuration, ConfigurationProject } from "./server/api";
import { getApiClient } from "./server/connection";
import { addDefinitionTab, addProjectFormTab, addTaskTab, getProjectFormTabIndex, getProjectFormTabLabel, getTabLabel, markInteraction, TabModel, updateProjectFormTab } from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";
import { isWailsEnvironment } from "./wails";
import { WindowSetTitle } from "./wailsjs/runtime";

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = useState(300);

  // Responsive layout: narrow (mobile) allows scrolling, regular/wide (desktop) is fixed
  const isNarrow = useResponsiveValue({ narrow: true, regular: false, wide: false }, false);
  const overflow = isNarrow ? "auto" : "hidden";
  const sidebarMinWidth = isNarrow ? 250 : 100;
  const mainMinWidth = isNarrow ? 300 : 0;

  useEffect(() => {
    if (tabs.length === 0 && projects.length === 0) {
      setTabs([{ type: "compiler" }]);
    }
  }, [tabs.length, projects.length]);

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

      const defaultMethod = getDefaultMethod(updatedProjects[0].services);
      setSelectedMethod(defaultMethod);

      if (!defaultMethod) {
        return;
      }

      setTabs(addTaskTab([], defaultMethod, updatedProjects[0]));
      setActiveTabIndex(0);
    }
  };

  const onMethodSelect = (method: Method, project: Project) => {
    setSelectedMethod(method);
    setTabs((tabs) => {
      tabs = addTaskTab(tabs, method, project);
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

  const disposeMonacoModelsForProject = (projectName: string) => {
    // Find and dispose all Monaco models for this project
    monaco.editor.getModels().forEach((model) => {
      if (model.uri.path.startsWith("/" + projectName + "/")) {
        model.dispose();
      }
    });
  };

  const createMonacoModelsForProject = (project: Project) => {
    project.sources.forEach((source) => {
      const uri = monaco.Uri.parse("ts:/" + source.path);
      const existingModel = monaco.editor.getModel(uri);
      if (!existingModel) {
        monaco.editor.createModel(source.file.text, "typescript", uri);
      } else {
        existingModel.setValue(source.file.text);
      }
    });
  };

  const refreshOpenTaskEditors = () => {
    // Touch task models to trigger re-validation against updated source models
    tabs.forEach((tab) => {
      if (tab.type === "task") {
        const value = tab.model.getValue();
        tab.model.setValue(value);
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

    // Update configuration
    const updatedConfiguration: Configuration = {
      ...configuration,
      projects: isEdit
        ? configuration.projects.map((p) => (p.name === originalName ? project : p))
        : [...configuration.projects, project],
    };

    // Save configuration via API
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      setConfiguration(response.configuration);
    }

    if (isEdit) {
      const originalProject = projects.find((p) => p.configuration.name === originalName);
      if (!originalProject) {
        return;
      }

      const protoDirChanged = originalProject.configuration.protoDir !== project.protoDir;
      const useReflectionChanged = originalProject.configuration.useReflection !== project.useReflection;
      const nameChanged = originalName !== project.name;

      if (protoDirChanged || useReflectionChanged) {
        // protoDir or useReflection changed - need full recompilation
        // Clear all project data so nothing stale remains if recompilation fails
        disposeMonacoModelsForProject(originalName);
        setProjects((prevProjects) =>
          prevProjects.map((p) =>
            p.configuration.name === originalName
              ? {
                  configuration: project,
                  compilation: { status: "pending" as const, logs: [] },
                  services: [],
                  clients: {},
                  sources: [],
                  stub: { serviceInfos: {} },
                }
              : p
          )
        );
        onCompilerClick();
      } else if (nameChanged) {
        // Name changed but protoDir didn't - remap sources and editor code without recompilation
        disposeMonacoModelsForProject(originalName);
        const remappedSources = remapSourcesToNewName(originalProject.sources, originalName, project.name);
        const remappedServices = originalProject.services.map((service) => ({
          ...service,
          methods: service.methods.map((method) => ({
            ...method,
            editorCode: remapEditorCode(method.editorCode, originalName, project.name),
          })),
        }));
        const updatedProject: Project = {
          ...originalProject,
          configuration: project,
          sources: remappedSources,
          services: remappedServices,
        };
        createMonacoModelsForProject(updatedProject);
        refreshOpenTaskEditors();
        setProjects((prevProjects) =>
          prevProjects.map((p) => (p.configuration.name === originalName ? updatedProject : p))
        );
        registerAIProvider(projects.map((p) => (p.configuration.name === originalName ? updatedProject : p)));
      } else {
        // URL or protocol changed - recreate clients
        const urlChanged = originalProject.configuration.url !== project.url;
        const protocolChanged = originalProject.configuration.protocol !== project.protocol;
        if (urlChanged || protocolChanged) {
          const newClients = createClients(originalProject.services, originalProject.stub, project);
          setProjects((prevProjects) =>
            prevProjects.map((p) =>
              p.configuration.name === originalName
                ? { ...p, configuration: project, clients: newClients }
                : p
            )
          );
        } else {
          // Just update config
          setProjects((prevProjects) =>
            prevProjects.map((p) =>
              p.configuration.name === originalName
                ? { ...p, configuration: project }
                : p
            )
          );
        }
      }
    } else {
      // Add new project
      const newProject: Project = {
        configuration: project,
        compilation: {
          status: "pending",
          logs: [],
        },
        services: [],
        clients: {},
        sources: [],
        stub: {},
      };
      setProjects((prevProjects) => [...prevProjects, newProject]);
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

    // Save configuration via API
    const client = getApiClient();
    const { response } = await client.updateConfiguration({ configuration: updatedConfiguration });
    if (response.configuration) {
      setConfiguration(response.configuration);
    }

    // Check if this is the last project
    const isLastProject = projects.length === 1;

    // Clean up Monaco models for deleted project
    disposeMonacoModelsForProject(projectName);

    // Remove project from state
    setProjects((prevProjects) => prevProjects.filter((p) => p.configuration.name !== projectName));

    // Refresh open editors to show red squiggles for broken imports
    refreshOpenTaskEditors();

    if (isLastProject) {
      // Show compiler tab when last project is deleted
      setTabs([{ type: "compiler" }]);
      setActiveTabIndex(0);
      setSelectedMethod(undefined);
    } else {
      // Clean up tabs related to this project
      setTabs((prevTabs) => {
        const newTabs = prevTabs.filter((tab) => {
          if (tab.type === "task") {
            return tab.originProject.configuration.name !== projectName;
          }
          return true;
        });
        if (activeTabIndex >= newTabs.length) {
          setActiveTabIndex(Math.max(0, newTabs.length - 1));
        }
        return newTabs;
      });
    }
  };

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <div style={{ position: "fixed", inset: 0, display: "flex", overflow, background: "var(--bgColor-default)", WebkitOverflowScrolling: isNarrow ? "touch" : undefined, overscrollBehavior: isNarrow ? "contain" : "none" }}>
          <div style={{ width: isNarrow ? 250 : sidebarWidth, minWidth: sidebarMinWidth, maxWidth: 600, display: "flex", flexShrink: 0 }}>
            <Sidebar
              projects={projects}
              canUpdateConfiguration={configuration?.system?.canUpdateConfiguration ?? false}
              onSelect={onMethodSelect}
              currentMethod={selectedMethod}
              onCompilerClick={onCompilerClick}
              onNewProjectClick={onNewProjectClick}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
            />
          </div>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: mainMinWidth, minHeight: 0 }}>
            {tabs.length === 0 && <GetStartedBlankslate />}
            {tabs.length > 0 && (
              <Tabs activeTabIndex={activeTabIndex} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onCloseAll={onCloseAll} onCloseOthers={onCloseOthers}>
                {tabs.map((tab, index) => {
                  if (tab.type === "compiler") {
                    return (
                      <Tab tabId="compiler" tabLabel="Compiler" key="compiler">
                        <Compiler
                          projects={projects}
                          canUpdateConfiguration={configuration?.system?.canUpdateConfiguration ?? false}
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
            )}
          </div>
        </div>
      </BaseStyles>
    </ThemeProvider>
  );
}
