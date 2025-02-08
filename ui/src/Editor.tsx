import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { formatTypeScript } from "./formatter";
import { ExtraLib } from "./project";

// Import the necessary Monaco Editor workers
self.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    return "./monaco/editor.worker.js";
  },
};

interface EditorProps {
  code: string;
  extraLibs: ExtraLib[];
  onMount: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

export function Editor({ code, extraLibs, onMount }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      // Create the Monaco editor instance
      const editor = monaco.editor.create(containerRef.current, {
        value: code,
        language: "typescript",
        theme: "vs-dark",
        automaticLayout: true,
      });
      editorRef.current = editor;
      editor.focus();

      // Add extra libraries and create models for declaration files
      extraLibs.forEach((extraLib) => {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(extraLib.content);
        //monaco.editor.createModel(extraLib.content, "typescript", monaco.Uri.parse("ts:filename/" + extraLib.filePath.replace(".ts", ".d.ts")));
      });

      // Register a document formatting provider for TypeScript
      monaco.languages.registerDocumentFormattingEditProvider("typescript", {
        async provideDocumentFormattingEdits(model: monaco.editor.ITextModel) {
          return [
            {
              text: await formatTypeScript(model.getValue()),
              range: model.getFullModelRange(),
            },
          ];
        },
      });

      // Call the onMount callback to notify parent component
      onMount(editor);

      return () => {
        editor.dispose();
      };
    }
  }, [code, extraLibs, onMount]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
