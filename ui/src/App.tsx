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
import { NewProjectForm } from "./NewProjectForm";
import { ConfigurationProject } from "./server/api";
import { addDefinitionTab, addTaskTab, getTabLabel, markInteraction, TabModel } from "./tabModel";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);

  useEffect(() => {
    if (tabs.length === 0 && projects.length === 0) {
      setTabs([{ type: "compiler" }]);
    }
  }, [tabs.length, projects.length]);

  const onCompilationUpdate = (updatedProjects: Project[] | ((prev: Project[]) => Project[])) => {
    // Handle both direct array and functional updates
    if (typeof updatedProjects === 'function') {
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

  const onNewProjectClick = () => {
    setShowNewProjectForm(true);
  };

  const onNewProjectSubmit = async (project: ConfigurationProject) => {
    setShowNewProjectForm(false);
    
    // Add project directly to the projects list
    const newProject: Project = {
      configuration: project,
      compilation: {
        status: "pending",
        logs: [],
      },
      services: [],
      clients: {},
      sources: [],
    };
    
    setProjects(prevProjects => [...prevProjects, newProject]);
    onCompilerClick();
  };

  const onNewProjectClose = () => {
    setShowNewProjectForm(false);
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
              onSelect={onMethodSelect}
              currentMethod={selectedMethod}
              onCompilerClick={onCompilerClick}
              onNewProjectClick={onNewProjectClick}
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
                        <Compiler projects={projects} onUpdate={onCompilationUpdate} />
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
        <NewProjectForm isOpen={showNewProjectForm} onSubmit={onNewProjectSubmit} onClose={onNewProjectClose} />
      </BaseStyles>
    </ThemeProvider>
  );
}
