import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { formatTypeScript } from "./formatter";
import { ExtraLib } from "./project";

self.MonacoEnvironment = {
  getWorker: function (workerId: string, label: string): Worker {
    const getWorkerModule = (moduleUrl: string, label: string) => {
      if (!self.MonacoEnvironment || !self.MonacoEnvironment.getWorkerUrl) {
        throw new Error("MonacoEnvironment not defined");
      }

      return new Worker(self.MonacoEnvironment.getWorkerUrl(workerId, moduleUrl), {
        name: label,
        type: "module",
      });
    };

    switch (label) {
      case "json":
        return getWorkerModule("/monaco-editor/esm/vs/language/json/json.worker?worker", label);
      case "css":
      case "scss":
      case "less":
        return getWorkerModule("/monaco-editor/esm/vs/language/css/css.worker?worker", label);
      case "html":
      case "handlebars":
      case "razor":
        return getWorkerModule("/monaco-editor/esm/vs/language/html/html.worker?worker", label);
      case "typescript":
      case "javascript":
        return getWorkerModule("/monaco-editor/esm/vs/language/typescript/ts.worker?worker", label);
      default:
        return getWorkerModule("/monaco-editor/esm/vs/editor/editor.worker?worker", label);
    }
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
