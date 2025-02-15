import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import * as monaco from "monaco-editor";
import { useState } from "react";
import { Compiler } from "./Compiler";
import { Gutter } from "./Gutter";
import { getDefaultMethod, Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { Tab, Tabs } from "./Tabs";
import { TabModel } from "./tabs";
import { Task } from "./Task";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
  const [tabs, setTabs] = useState<TabModel[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [sidebarWidth, setSidebarWidth] = useState(300);

  const onProject = (project: Project) => {
    setProject(project);
    setSelectedMethod(getDefaultMethod(project.services));

    project.extraLibs.forEach((extraLib) => {
      monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:/" + extraLib.filePath));
    });
  };

  const onMethodSelect = (method: Method) => {
    setSelectedMethod(method);
  };

  const onSidebarResize = (delta: number) => {
    setSidebarWidth((width) => width + delta);
  };

  const handleCloseTab = (tabId: string) => {
    // Handle tab closing logic here
    console.log(`Closing tab: ${tabId}`);
  };

  if (tabs.length === 0) {
    setTabs([{ type: "compiler" }]);
  }

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <Box sx={{ display: "flex", width: "100vw", height: "100vh", bg: "canvas.default" }}>
          <Box sx={{ width: sidebarWidth, minWidth: 100, maxWidth: 600, flexShrink: 0, overflow: "scroll" }}>
            <Sidebar project={project} onSelect={onMethodSelect} currentMethod={selectedMethod} />
          </Box>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <Tabs defaultTab="compiler" onCloseTab={handleCloseTab}>
                {tabs.map((tab) => {
                  if (tab.type === "compiler") {
                    return (
                      <Tab tabId="compiler" tabLabel="Compiling..." key="compiler">
                        <Compiler onProject={onProject} />
                      </Tab>
                    );
                  }

                  if (tab.type === "task" && project) {
                    return (
                      <Tab tabId="task" tabLabel="Task" key="task">
                        {selectedMethod && <Task code={selectedMethod.editorCode} project={project} />}
                      </Tab>
                    );
                  }

                  throw new Error("Unknown tab type");
                })}
              </Tabs>
            </Box>
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
