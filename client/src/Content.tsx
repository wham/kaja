import { Editor, Monaco } from "@monaco-editor/react";
import { PlayIcon } from "@primer/octicons-react";
import { Box, IconButton } from "@primer/react";
import { editor } from "monaco-editor";
import React, { useEffect } from "react";
import { Console } from "./Console";
import { formatTypeScript } from "./formatter";
import { Method, Project, Service } from "./project";
import { LogLevel } from "./server/server";

interface ContentProps {
  project: Project;
  service: Service;
  method: Method;
}

export function Content({ project, method }: ContentProps) {
  const codeEditorRef = React.useRef<editor.IStandaloneCodeEditor>();
  const [consoleChildren, setConsoleChildren] = React.useState<React.ReactElement[]>([]);

  function handleCodeEditorDidMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco, project: Project) {
    codeEditorRef.current = editor;
    editor.focus();

    project.extraLibs.forEach((extraLib) => {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(extraLib.content);
      monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:filename/" + extraLib.filePath.replace(".ts", ".d.ts")));
    });
  }

  window.setOutput = (endpoint: string, output: string, isError: boolean) => {
    setConsoleChildren((consoleChildren) => [
      ...consoleChildren,
      <Console.Logs key={consoleChildren.length * 2} logs={[{ index: 0, level: isError ? LogLevel.LEVEL_ERROR : LogLevel.LEVEL_INFO, message: endpoint }]} />,
      <Console.Json key={consoleChildren.length * 2 + 1} json={output} />,
    ]);
  };

  async function callMethod() {
    if (codeEditorRef.current) {
      let code = codeEditorRef.current.getValue();
      let lines = code.split("\n"); // split the code into lines
      let isInImport = false;
      // remove import statements
      while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
        isInImport = !lines[0].endsWith(";");
        lines.shift();
      }
      code = lines.join("\n");
      const func = new Function(code);
      func();
    }
  }

  useEffect(() => {
    formatTypeScript(method.editorCode).then((formattedEditorCode) => {
      if (codeEditorRef.current) {
        codeEditorRef.current.setValue(formattedEditorCode);
      }
    });
  }, [method.editorCode]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Box sx={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "border.default", flexGrow: 0 }}>
        <Editor
          height="50vh"
          defaultLanguage="typescript"
          defaultValue={method.editorCode}
          onMount={(editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
            handleCodeEditorDidMount(editor, monaco, project);
          }}
          theme="vs-dark"
          options={{ minimap: { enabled: false }, renderLineHighlight: "none" }}
        />
        <Box sx={{ position: "absolute", top: "10px", right: "30px" }}>
          <IconButton icon={PlayIcon} aria-label="Call" variant="primary" size="large" onClick={callMethod} />
        </Box>
      </Box>
      <Box sx={{ color: "fg.default", overflow: "scroll", flexGrow: 1, paddingX: 1 }}>
        <Console>{consoleChildren}</Console>
      </Box>
    </Box>
  );
}
