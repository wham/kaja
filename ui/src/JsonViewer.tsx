import * as monaco from "monaco-editor";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatJson } from "./formatter";

interface JsonViewerProps {
  value: any;
  colorMode?: "day" | "night";
}

export interface JsonViewerHandle {
  foldAll: () => void;
  unfoldAll: () => void;
  copyToClipboard: () => void;
}

export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer({ value, colorMode = "night" }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [jsonText, setJsonText] = useState("");

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    foldAll: () => {
      editorRef.current?.trigger("fold", "editor.foldAll", null);
    },
    unfoldAll: () => {
      editorRef.current?.trigger("unfold", "editor.unfoldAll", null);
    },
    copyToClipboard: async () => {
      try {
        await navigator.clipboard.writeText(jsonText);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    },
  }));

  // Format JSON and update editor
  useEffect(() => {
    async function updateContent() {
      let text = JSON.stringify(value);
      if (text === undefined || text === null) {
        text = "";
      }
      text = await formatJson(text);
      setJsonText(text);

      if (editorRef.current) {
        editorRef.current.setValue(text);
      }
    }
    updateContent();
  }, [value]);

  // Create editor
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    editorRef.current = monaco.editor.create(containerRef.current, {
      value: jsonText,
      language: "javascript", // Use JS instead of JSON to avoid worker errors (JSON is valid JS)
      theme: colorMode === "night" ? "vs-dark" : "vs",
      automaticLayout: true,
      // Read-only configuration
      readOnly: true,
      domReadOnly: true,
      // Disable interactive features
      contextmenu: false,
      cursorStyle: "block",
      cursorBlinking: "solid",
      renderLineHighlight: "none",
      selectionHighlight: false,
      occurrencesHighlight: "off",
      // Enable folding
      folding: true,
      foldingStrategy: "indentation",
      foldingHighlight: true,
      showFoldingControls: "always",
      // Visual settings
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: "off",
      glyphMargin: false,
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      // Scrollbar
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      // Disable hints and suggestions
      quickSuggestions: false,
      parameterHints: { enabled: false },
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: "off",
      wordBasedSuggestions: "off",
      // Links
      links: false,
    });

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {colorMode === "night" && (
        <style>{`
          .json-viewer-container .monaco-editor,
          .json-viewer-container .monaco-editor-background,
          .json-viewer-container .monaco-editor .margin {
            background-color: var(--bgColor-default) !important;
          }
        `}</style>
      )}
      {/* Editor */}
      <div ref={containerRef} className="json-viewer-container" style={{ height: "100%" }} />
    </div>
  );
});
