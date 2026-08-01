import * as monaco from "monaco-editor";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatJson } from "./formatter";
import "./monacoTheme";

// A private language rather than the built-in "json" one: that language is wired
// to the JSON language service, which validates every JSON model against the app
// configuration schema (see AppForm) and would flag responses as errors. Only
// tokenization is needed here, and it runs on the main thread — no worker.
const LANGUAGE_ID = "kaja-json";

monaco.languages.register({ id: LANGUAGE_ID });
monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key.json"],
      [/"(?:[^"\\]|\\.)*"/, "string.value.json"],
      [/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, "number.json"],
      [/\b(?:true|false|null)\b/, "keyword.json"],
      [/[{}]/, "delimiter.bracket.json"],
      [/[[\]]/, "delimiter.array.json"],
      [/:/, "delimiter.colon.json"],
      [/,/, "delimiter.comma.json"],
    ],
  },
});

interface JsonViewerProps {
  value: any;
  rawText?: string;
}

export interface JsonViewerHandle {
  foldAll: () => void;
  unfoldAll: () => void;
  copyToClipboard: () => void;
}

export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer({ value, rawText }, ref) {
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

  // Create editor (must run before the value-setting effect so editorRef.current is set when it runs)
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    editorRef.current = monaco.editor.create(containerRef.current, {
      value: jsonText,
      language: LANGUAGE_ID,
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

  // Format JSON and update editor
  useEffect(() => {
    async function updateContent() {
      let text: string;
      if (rawText !== undefined) {
        text = rawText;
      } else {
        let stringified = JSON.stringify(value);
        if (stringified === undefined || stringified === null) {
          stringified = "";
        }
        text = await formatJson(stringified);
      }
      setJsonText(text);

      if (editorRef.current) {
        editorRef.current.setValue(text);
      }
    }
    updateContent();
  }, [value, rawText]);

  return (
    <div className="relative h-full">
      <style>{`
        .json-viewer-container .monaco-editor,
        .json-viewer-container .monaco-editor-background,
        .json-viewer-container .monaco-editor .margin {
          background-color: var(--muted) !important;
        }
      `}</style>
      {/* Editor */}
      <div ref={containerRef} className="json-viewer-container h-full bg-muted" />
    </div>
  );
});
