import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import { editor } from "monaco-editor";
import { useRef, useState } from "react";
import { Compiler } from "./Compiler";
import { Console, ConsoleItem } from "./Console";
import { ControlBar } from "./ControlBar";
import { Editor } from "./Editor";
import { Gutter } from "./Gutter";
import { Kaja, MethodCall } from "./kaja";
import { Method, Project } from "./project";
import { Sidebar } from "./Sidebar";
import { Tab, Tabs } from "./Tabs";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

export function App() {
  const [project, setProject] = useState<Project>();
  const [selectedMethod, setSelectedMethod] = useState<Method>();
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [editorHeight, setEditorHeight] = useState(400);
  const editorRef = useRef<editor.IStandaloneCodeEditor>();
  const logsOffsetRef = useRef(0);
  const kajaRef = useRef(new Kaja(onMethodCallUpdate));

  function onMethodCallUpdate(methodCall: MethodCall) {
    setConsoleItems((consoleItems) => {
      const index = consoleItems.findIndex((item) => item === methodCall);

      if (index > -1) {
        return consoleItems.map((item, i) => {
          if (i === index) {
            return { ...methodCall };
          }
          return item;
        });
      } else {
        return [...consoleItems, methodCall];
      }
    });
  }

  function onEditorMount(editor: editor.IStandaloneCodeEditor) {
    editorRef.current = editor;
  }

  const onEditorResize = (delta: number) => {
    setEditorHeight((height) => height + delta);
  };

  const onMethodSelect = (method: Method) => {
    setSelectedMethod(method);
  };

  const onSidebarResize = (delta: number) => {
    setSidebarWidth((width) => width + delta);
  };

  async function callMethod() {
    if (logsOffsetRef.current > 0) {
      logsOffsetRef.current = 0;
      setConsoleItems([]);
    }

    if (!editorRef.current || !project) {
      return;
    }

    let lines = editorRef.current.getValue().split("\n"); // split the code into lines
    let isInImport = false;
    // remove import statements
    while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
      isInImport = !lines[0].endsWith(";");
      lines.shift();
    }

    for (const client of Object.values(project.clients)) {
      client.kaja = kajaRef.current;
    }

    const func = new Function(...Object.keys(project.clients), "kaja", lines.join("\n"));
    func(...Object.values(project.clients).map((client) => client.methods), kajaRef.current);
  }

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
              <Box
                sx={{
                  height: editorHeight,
                  borderTopWidth: 1,
                  borderTopStyle: "solid",
                  borderTopColor: "border.default",
                  position: "relative",
                }}
              >
                <ControlBar onRun={callMethod} />
                <Tabs defaultTab="compiler" onCloseTab={handleCloseTab}>
                  {project
                    ? [
                        <Tab tabId="editor" tabLabel="Editor" key="editor">
                          {selectedMethod && <Editor code={selectedMethod.editorCode} extraLibs={project.extraLibs} onMount={onEditorMount} />}
                        </Tab>,
                        <Tab tabId="console" tabLabel="Console" key="console">
                          <Console items={consoleItems} />
                        </Tab>,
                      ]
                    : [
                        <Tab tabId="compiler" tabLabel="Compiling..." key="compiler">
                          <Compiler onProject={setProject} />
                        </Tab>,
                      ]}
                </Tabs>
              </Box>
              <Gutter orientation="horizontal" onResize={onEditorResize} />
            </Box>
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
