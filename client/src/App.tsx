import { BaseStyles, Box, ThemeProvider } from "@primer/react";
import { ReactElement, useEffect, useRef, useState } from "react";
import { Console } from "./Console";
import { ControlBar } from "./ControlBar";
import { Editor } from "./Editor";
import { Gutter } from "./Gutter";
import { Endpoint, Method, Project, Service, getDefaultEndpoint } from "./project";
import { loadProject, registerGlobalTriggers } from "./projectLoader";
import { CompileStatus, Log, LogLevel } from "./server/api";
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
  const [consoleChildren, setConsoleChildren] = useState<ReactElement[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [editorHeight, setEditorHeight] = useState(400);
  const editorCodeRef = useRef("");

  console.log("Rendering App", project);

  function onEditorChange(code: string | undefined) {
    console.log("onEditorChange", code);
    editorCodeRef.current = code || "";
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
    setLogs([]);
    logsRef.current = [];

    let lines = editorCodeRef.current.split("\n"); // split the code into lines
    let isInImport = false;
    // remove import statements
    while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
      isInImport = !lines[0].endsWith(";");
      lines.shift();
    }

    const func = new Function(lines.join("\n"));
    func();
  }

  const [logs, setLogs] = useState<Log[]>([]);
  const logsRef = useRef(logs);
  const client = getApiClient();

  const compile = (ignoreToken: IgnoreToken) => {
    console.log("Current logs", logsRef.current);
    client.compile({ logOffset: logsRef.current.length, force: true }).then(({ response }) => {
      if (ignoreToken.ignore) {
        return;
      }

      setLogs([...logsRef.current, ...response.logs]);
      logsRef.current = [...logsRef.current, ...response.logs];

      if (response.status === CompileStatus.STATUS_RUNNING) {
        setTimeout(() => {
          compile(ignoreToken);
        }, 1000);
      } else {
        onCompile(response.sources);
      }
    });
  };

  window.setOutput = (endpoint: string, output: string, isError: boolean) => {
    setConsoleChildren((consoleChildren) => [
      ...consoleChildren,
      <Console.Logs key={consoleChildren.length * 2} logs={[{ index: 0, level: isError ? LogLevel.LEVEL_ERROR : LogLevel.LEVEL_INFO, message: endpoint }]} />,
      <Console.Json key={consoleChildren.length * 2 + 1} json={output} />,
    ]);
  };

  useEffect(() => {
    const ignoreToken: IgnoreToken = { ignore: false };
    console.log("useEffect");
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
                {project && selectedEndpoint && <Editor code={selectedEndpoint.method.editorCode} extraLibs={project.extraLibs} onChange={onEditorChange} />}
              </Box>
              <Gutter orientation="horizontal" onResize={onEditorResize} />
              <Box sx={{ color: "fg.default", overflowY: "scroll", paddingX: 1 }}>
                <Console>
                  <Console.Logs logs={logs} /> {consoleChildren}
                </Console>
              </Box>
            </Box>
          </Box>
        </Box>
      </BaseStyles>
    </ThemeProvider>
  );
}
