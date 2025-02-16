import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { formatTypeScript } from "./formatter";

self.MonacoEnvironment = {
  getWorkerUrl: function (_, label) {
    if (label === "json") {
      return "./monaco.json.worker.js";
    }
    if (label === "css" || label === "scss" || label === "less") {
      return "./monaco.css.worker.js";
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return "./monaco.html.worker.js";
    }
    if (label === "typescript" || label === "javascript") {
      return "./monaco.ts.worker.js";
    }
    return "./monaco.editor.worker.js";
  },
};

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

interface EditorProps {
  model: monaco.editor.ITextModel;
  onMount: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

export function Editor({ model, onMount }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let isDisposing = false;

    if (!editorRef.current) {
      editorRef.current = monaco.editor.create(containerRef.current, {
        model,
        language: "typescript",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: {
          enabled: false,
        },
        renderLineHighlight: "none",
        formatOnPaste: true,
        formatOnType: true,
        tabSize: 2,
      });

      onMount(editorRef.current);
    }

    // Format code before setting it
    formatTypeScript(model.getValue()).then((formattedCode) => {
      if (!isDisposing && editorRef.current) {
        editorRef.current.setValue(formattedCode);
      }
    });

    if (editorRef.current) {
      editorRef.current.setModel(model);
    }

    return () => {
      isDisposing = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [model]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
