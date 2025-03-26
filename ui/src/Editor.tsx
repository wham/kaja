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

monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
});

interface EditorProps {
  model: monaco.editor.ITextModel;
  onMount: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onGoToDefinition: (model: monaco.editor.ITextModel) => void;
}

export function Editor({ model, onMount, onGoToDefinition }: EditorProps) {
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
        inlineSuggest: {
          enabled: true,
          mode: "subwordSmart",
          showToolbar: "always",
        },
        quickSuggestions: {
          other: "inline",
          comments: "inline",
          strings: "inline",
        },
        suggest: {
          preview: true,
          showInlineDetails: true,
          showMethods: true,
          showFunctions: true,
          showVariables: true,
          showConstants: true,
          showConstructors: true,
          showFields: true,
          showFiles: true,
        },
      });

      const editorService = (editorRef.current as any)._codeEditorService;
      const openEditorBase = editorService.openCodeEditor.bind(editorService);
      editorService.openCodeEditor = async (input: { resource: monaco.Uri }, source: monaco.editor.ICodeEditor) => {
        const result = await openEditorBase(input, source);
        if (result === null) {
          alert("intercepted");
          console.log("Open definition for:", input);
          console.log("Corresponding model:", monaco.editor.getModel(input.resource));
          console.log("Source: ", source);
          //source.setModel(monaco.editor.getModel(input.resource));
          const model = monaco.editor.getModel(input.resource);
          if (model) {
            onGoToDefinition(model);
          }
        }
        return result;
      };

      onMount(editorRef.current);
    }

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
