import { Editor, Monaco } from "@monaco-editor/react";
import { PlayIcon } from "@primer/octicons-react";
import { Box, IconButton } from "@primer/react";
import { editor } from "monaco-editor";
import * as prettier from "prettier";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEsTree from "prettier/plugins/estree";
import prettierPluginTypescript from "prettier/plugins/typescript";
import React, { useEffect } from "react";
import { Method, Project, Service } from "./project";

type ContentProps = {
  project: Project;
  service: Service;
  method: Method;
};

export function Content({ project, method }: ContentProps) {
  const codeEditorRef = React.useRef<editor.IStandaloneCodeEditor>();
  const consoleEditorRef = React.useRef<editor.IStandaloneCodeEditor>();

  function handleCodeEditorDidMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco, project: Project) {
    codeEditorRef.current = editor;
    editor.focus();

    project.extraLibs.forEach((extraLib) => {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(extraLib.content);
      monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:filename/" + extraLib.filePath.replace(".ts", ".d.ts")));
    });
  }

  function handleConsoleEditorDidMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco, project: Project) {
    consoleEditorRef.current = editor;

    const styles = editor.getDomNode()?.style;

    if (styles) {
      // https://github.com/microsoft/monaco-editor/issues/338#issuecomment-1763246584
      styles.setProperty("--vscode-editor-background", "#000000");
      styles.setProperty("--vscode-editorGutter-background", "#000000");
    }

    prettier
      .format(method.editorCode, { parser: "typescript", plugins: [prettierPluginTypescript, prettierPluginEsTree] })
      .then((formattedEditorCode) => {
        if (codeEditorRef.current) {
          codeEditorRef.current.setValue(formattedEditorCode);
        }
      })
      .catch((error) => {
        console.error("Failed to format the method code", error);
        if (codeEditorRef.current) {
          codeEditorRef.current.setValue(method.editorCode);
        }
      });
  }

  window.setOutput = (output: string) => {
    prettier
      .format(output, { parser: "json", plugins: [prettierPluginBabel, prettierPluginEsTree] })
      .then((formattedOutput) => {
        if (consoleEditorRef.current) {
          consoleEditorRef.current.setValue(formattedOutput);
        }
      })
      .catch((error) => {
        console.warn("Failed to format the output", error);
        if (consoleEditorRef.current) {
          consoleEditorRef.current.setValue(output);
        }
      });
  };

  async function callMethod() {
    if (consoleEditorRef.current) {
      consoleEditorRef.current.setValue("");
    }

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
    prettier
      .format(method.editorCode, { parser: "typescript", plugins: [prettierPluginTypescript, prettierPluginEsTree] })
      .then((formattedEditorCode) => {
        if (codeEditorRef.current) {
          codeEditorRef.current.setValue(formattedEditorCode);
        }
      })
      .catch((error) => {
        console.error("Failed to format the method code", error);
        if (codeEditorRef.current) {
          codeEditorRef.current.setValue(method.editorCode);
        }
      });

    if (consoleEditorRef.current) {
      consoleEditorRef.current.setValue("");
    }
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "border.default" }}>
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
      <Box sx={{ color: "fg.default" }}>
        <Editor
          height="50vh"
          defaultLanguage="typescript"
          onMount={(editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
            handleConsoleEditorDidMount(editor, monaco, project);
          }}
          theme="vs-dark"
          options={{ readOnly: true, minimap: { enabled: false }, renderLineHighlight: "none", lineNumbers: "off" }}
        />
      </Box>
    </Box>
  );
}
