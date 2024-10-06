import { Monaco } from "@monaco-editor/react";
import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { ControlBar } from "./ControlBar";
import { Editor } from "./Editor";
import { Gutter } from "./Gutter";
import { Endpoint, Method, Project, Service, getDefaultEndpoint } from "./project";
import { loadProject, registerGlobalTriggers } from "./projectLoader";
import { CompileStatus } from "./server/api";
import { getApiClient } from "./server/connection";
import { Sidebar } from "./Sidebar";

// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
(BigInt.prototype as any)["toJSON"] = function () {
  return this.toString();
};

interface IgnoreToken {
  ignore: boolean;
}

export function App() {
  const [project, setProject] = useState<Project>();
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>();
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [editorHeight, setEditorHeight] = useState(400);
  const editorRef = useRef<editor.IStandaloneCodeEditor>();
  const monacoRef = useRef<Monaco>();
  const logsOffsetRef = useRef(0);

  console.log("Rendering App", project);

  function onEditorMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }

  const onEditorResize = (delta: number) => {
    setEditorHeight((height) => height + delta);
  };

  const onCompile = async (sources: string[]) => {
    const project = await loadProject(sources);
    registerGlobalTriggers(project.services);
    setProject(project);
    setSelectedEndpoint(getDefaultEndpoint(project.services));
  };

  const onSelect = (service: Service, method: Method) => {
    setSelectedEndpoint({ service, method });
  };

  const onSidebarResize = (delta: number) => {
    setSidebarWidth((width) => width + delta);
  };

  async function callMethod() {
    if (logsOffsetRef.current > 0) {
      logsOffsetRef.current = 0;
      setConsoleItems([]);
    }

    if (!editorRef.current) {
      return;
    }

    let lines = editorRef.current.getValue().split("\n"); // split the code into lines
    let isInImport = false;
    // remove import statements
    while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
      isInImport = !lines[0].endsWith(";");
      lines.shift();
    }

    const func = new Function(lines.join("\n"));
    func();
  }

  const client = getApiClient();

  const compile = (ignoreToken: IgnoreToken) => {
    client.compile({ logOffset: logsOffsetRef.current, force: true }).then(({ response }) => {
      if (ignoreToken.ignore) {
        return;
      }

      logsOffsetRef.current += response.logs.length;
      setConsoleItems((consoleItems) => [...consoleItems, response.logs]);

      if (response.status === CompileStatus.STATUS_RUNNING) {
        setTimeout(() => {
          compile(ignoreToken);
        }, 1000);
      } else {
        onCompile(response.sources);
      }
    });
  };

  window.kaja = {
    onMethodCall: (serviceName: string, methodName: string, input: any, output: any) => {
      setConsoleItems((consoleItems) => [
        ...consoleItems,
        {
          serviceName,
          methodName,
          input,
          output,
        },
      ]);
    },
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };
    compile(ignoreToken);

    return () => {
      ignoreToken.ignore = true;
    };
  }, []);

  return (
    <ThemeProvider colorMode="night">
      <BaseStyles>
        <Box sx={{ display: "flex", width: "100vw", height: "100vh", bg: "canvas.default" }}>
          <Box sx={{ width: sidebarWidth, minWidth: 100, maxWidth: 600, flexShrink: 0, overflow: "scroll" }}>
            <Sidebar project={project} onSelect={onSelect} currentMethod={selectedEndpoint && selectedEndpoint.method} />
          </Box>
          <Gutter orientation="vertical" onResize={onSidebarResize} />
          <Box sx={{ flexGrow: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <ControlBar onRun={callMethod} />
              <Box
                sx={{
                  height: editorHeight,
                  borderTopWidth: 1,
                  borderTopStyle: "solid",
                  borderTopColor: "border.default",
                }}
              >
                {project && selectedEndpoint && <Editor code={selectedEndpoint.method.editorCode} extraLibs={project.extraLibs} onMount={onEditorMount} />}
              </Box>
              <Gutter orientation="horizontal" onResize={onEditorResize} />
              <Box sx={{ color: "fg.default", overflowY: "scroll", paddingX: 1 }}>
                <Console items={consoleItems} monaco={monacoRef.current} />
              </Box>
            </Box>
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
