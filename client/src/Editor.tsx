import { Monaco, Editor as MonacoEditor } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import React, { useEffect } from "react";
import { formatTypeScript } from "./formatter";
import { ExtraLib } from "./project";

interface EditorProps {
  code: string;
  extraLibs: ExtraLib[];
  onChange: (code: string | undefined) => void;
}

export function Editor({ code, extraLibs, onChange }: EditorProps) {
  const editorRef = React.useRef<editor.IStandaloneCodeEditor>();

  const onMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
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
    onChange(editor.getValue());
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument")?.run();
    }
  });

  onChange(code);

  return (
    <MonacoEditor
      width="100%"
      height="100%"
      defaultLanguage="typescript"
      onChange={onChange}
      onMount={onMount}
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
