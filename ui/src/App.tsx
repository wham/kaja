import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import * as monaco from "monaco-editor";
import { useState } from "react";
import { Compiler } from "./Compiler";
import { Gutter } from "./Gutter";
import { getDefaultMethod, Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { Tab, Tabs } from "./Tabs";
import { Task } from "./Task";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
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
                {project
                  ? [
                      <Tab tabId="task" tabLabel="Task" key="task">
                        {selectedMethod && <Task code={selectedMethod.editorCode} project={project} />}
                      </Tab>,
                    ]
                  : [
                      <Tab tabId="compiler" tabLabel="Compiling..." key="compiler">
                        <Compiler onProject={onProject} />
                      </Tab>,
                    ]}
              </Tabs>
            </Box>
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
