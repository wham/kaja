import "@primer/primitives/dist/css/functional/themes/dark.css";
import { BaseStyles, ThemeProvider } from "@primer/react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { registerAIProvider } from "./ai";
import { Blankslate } from "./Blankslate";
import { Compiler } from "./Compiler";
import { Definition } from "./Definition";
import { Gutter } from "./Gutter";
import { getDefaultMethod, Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { ProjectForm } from "./ProjectForm";
import { remapSourcesToNewName } from "./sources";
import { createClients } from "./projectLoader";
import { Configuration, ConfigurationProject } from "./server/api";
import { getApiClient } from "./server/connection";
import { addDefinitionTab, addTaskTab, getTabLabel, markInteraction, TabModel } from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<ConfigurationProject | undefined>();

  useEffect(() => {
    if (tabs.length === 0 && projects.length === 0) {
      setTabs([{ type: "compiler" }]);
    }
  }, [tabs.length, projects.length]);

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

      setTabs(addTaskTab([], defaultMethod));
    }
  };

  const onMethodSelect = (method: Method) => {
    setSelectedMethod(method);
    setTabs((tabs) => {
      tabs = addTaskTab(tabs, method);
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
    if (tabs[index].type === "task") {
      tabs[index].model.dispose();
    }

    setTabs((tabs) => {
      const newTabs = tabs.filter((_, i) => i !== index);
      // Calculate new active index in the same update
      const newActiveIndex = index === activeTabIndex ? Math.max(0, newTabs.length - 1) : index < activeTabIndex ? activeTabIndex - 1 : activeTabIndex;

      // Schedule active index update for next render
      Promise.resolve().then(() => setActiveTabIndex(newActiveIndex));

      return newTabs;
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
    setEditingProject(undefined);
    setShowProjectForm(true);
  };

  const onEditProject = (projectName: string) => {
    const project = projects.find((p) => p.configuration.name === projectName);
    if (project) {
      setEditingProject(project.configuration);
      setShowProjectForm(true);
    }
  };

  const onProjectFormSubmit = async (project: ConfigurationProject, originalName?: string) => {
    setShowProjectForm(false);
    setEditingProject(undefined);

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
      const nameChanged = originalName !== project.name;

      if (protoDirChanged) {
        // protoDir changed - need full recompilation
        setProjects((prevProjects) =>
          prevProjects.map((p) =>
            p.configuration.name === originalName
              ? {
                  ...p,
                  configuration: project,
                  compilation: { status: "pending" as const, logs: [] },
                }
              : p
          )
        );
        if (nameChanged) {
          disposeMonacoModelsForProject(originalName);
        }
        onCompilerClick();
      } else if (nameChanged) {
        // Name changed but protoDir didn't - remap sources without recompilation
        disposeMonacoModelsForProject(originalName);
        const remappedSources = remapSourcesToNewName(originalProject.sources, originalName, project.name);
        const updatedProject: Project = {
          ...originalProject,
          configuration: project,
          sources: remappedSources,
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

  const onProjectFormClose = () => {
    setShowProjectForm(false);
    setEditingProject(undefined);
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

    // Remove project from state
    setProjects((prevProjects) => prevProjects.filter((p) => p.configuration.name !== projectName));

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
            return tab.originMethod.name !== projectName;
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
        <div style={{ display: "flex", width: "100vw", height: "100vh", background: "var(--bgColor-default)" }}>
          <div
            style={{
              width: sidebarWidth,
              minWidth: 100,
              maxWidth: 600,
              flexShrink: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
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
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
            {tabs.length === 0 && <Blankslate />}
            {tabs.length > 0 && (
              <Tabs activeTabIndex={activeTabIndex} onSelectTab={onSelectTab} onCloseTab={onCloseTab}>
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

                  throw new Error("Unknown tab type");
                })}
              </Tabs>
            )}
          </div>
        </div>
        <ProjectForm
          isOpen={showProjectForm}
          mode={editingProject ? "edit" : "create"}
          initialData={editingProject}
          onSubmit={onProjectFormSubmit}
          onClose={onProjectFormClose}
        />
      </BaseStyles>
    </ThemeProvider>
  );
}
