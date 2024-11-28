import { Monaco, Editor as MonacoEditor } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import React, { useEffect } from "react";
import { formatTypeScript } from "./formatter";
import { ExtraLib } from "./project";

interface EditorProps {
  code: string;
  extraLibs: ExtraLib[];
  onMount: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
}

export function Editor({ code, extraLibs, onMount }: EditorProps) {
  const editorRef = React.useRef<editor.IStandaloneCodeEditor>();

  const handleOnMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    editor.focus();

    extraLibs.forEach((extraLib) => {
      monaco.languages.typescript.typescriptDefaults.addExtraLib(extraLib.content);
      monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:filename/" + extraLib.filePath.replace(".ts", ".d.ts")));
    });

    monaco.languages.registerDocumentFormattingEditProvider("typescript", {
      async provideDocumentFormattingEdits(model: editor.ITextModel) {
        return [
          {
            text: await formatTypeScript(model.getValue()),
            range: model.getFullModelRange(),
          },
        ];
      },
    });

    editor.getAction("editor.action.formatDocument")?.run();

    onMount(editor, monaco);
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument")?.run();
      editorRef.current.focus();
      editorRef.current.setScrollTop(0);
    }
  });

  return (
    <MonacoEditor
      width="100%"
      height="100%"
      defaultLanguage="typescript"
      onMount={handleOnMount}
      theme="vs-dark"
      value={code}
      // See index.html for additional .monaco-editor fix to enable automatic resizing
      options={{
        minimap: { enabled: false },
        renderLineHighlight: "none",
        formatOnPaste: true,
        formatOnType: true,
        tabSize: 2,
      }}
    />
  );
}
