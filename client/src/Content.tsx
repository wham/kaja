import { Editor, Monaco } from "@monaco-editor/react";
import { Box } from "@primer/react";
import { editor } from "monaco-editor";
import React, { useEffect } from "react";
import { Console } from "./Console";
import { ControlBar } from "./ControlBar";
import { formatTypeScript } from "./formatter";
import { Gutter } from "./Gutter";
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
  const [editorHeight, setEditorHeight] = React.useState(400);

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

  const onEditorResize = (delta: number) => {
    setEditorHeight((height) => height + delta);
  };

  return (
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
        <Editor
          width="100%"
          height="100%"
          defaultLanguage="typescript"
          defaultValue={method.editorCode}
          onMount={(editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
            handleCodeEditorDidMount(editor, monaco, project);
          }}
          theme="vs-dark"
          // See index.html for additional .monaco-editor fix to enable automatic resizing
          options={{ minimap: { enabled: false }, renderLineHighlight: "none" }}
        />
      </Box>
      <Gutter orientation="horizontal" onResize={onEditorResize} />
      <Box sx={{ color: "fg.default", overflowY: "scroll", paddingX: 1 }}>
        <Console>{consoleChildren}</Console>
      </Box>
    </Box>
  );
}
