import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { Blankslate } from "./Blankslate";
import { Compiler } from "./Compiler";
import { Gutter } from "./Gutter";
import { getDefaultMethod, Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { Tab, Tabs } from "./Tabs";
import { addTaskTab, markInteraction, newTaskTab, TabModel } from "./tabsm";
import { Task } from "./Task";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = useState(300);

  useEffect(() => {
    if (tabs.length === 0 && !project) {
      setTabs([{ type: "compiler" }]);
    }
  }, [tabs.length, project]);

  const onProject = (project: Project) => {
    const defaultMethod = getDefaultMethod(project.services);
    setProject(project);
    setSelectedMethod(defaultMethod);

    project.extraLibs.forEach((extraLib) => {
      monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:/" + extraLib.filePath));
    });

    if (!defaultMethod) {
      return;
    }

    setTabs([newTaskTab(defaultMethod)]);
  };

  const onMethodSelect = (method: Method) => {
    setSelectedMethod(method);
    setTabs((tabs) => {
      tabs = addTaskTab(tabs, method);
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

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <Box sx={{ display: "flex", width: "100vw", height: "100vh", bg: "canvas.default" }}>
          <Box sx={{ width: sidebarWidth, minWidth: 100, maxWidth: 600, flexShrink: 0, overflow: "scroll", paddingX: 2, paddingY: 1 }}>
            <Sidebar project={project} onSelect={onMethodSelect} currentMethod={selectedMethod} />
          </Box>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {tabs.length === 0 && <Blankslate />}
            {tabs.length > 0 && (
              <Tabs activeTabIndex={activeTabIndex} onSelectTab={onSelectTab} onCloseTab={onCloseTab}>
                {tabs.map((tab, index) => {
                  if (tab.type === "compiler") {
                    return (
                      <Tab tabId="compiler" tabLabel="Compiling..." key="compiler">
                        <Compiler onProject={onProject} />
                      </Tab>
                    );
                  }

                  if (tab.type === "task" && project) {
                    return (
                      <Tab tabId={tab.id} tabLabel={tab.originMethod.name} isEphemeral={!tab.hasInteraction && index === tabs.length - 1} key="task">
                        <Task model={tab.model} project={project} onInteraction={() => setTabs((tabs) => markInteraction(tabs, index))} />
                      </Tab>
                    );
                  }

                  throw new Error("Unknown tab type");
                })}
              </Tabs>
            )}
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
