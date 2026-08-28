import * as monaco from "monaco-editor";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { copyText } from "./clipboard";
import { codeFontSize } from "./monacoTheme";
import { drawnText, printJson } from "./payloadText";

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
  copyToClipboard: () => Promise<boolean>;
}

export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer({ value, rawText }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const jsonTextRef = useRef("");

  useImperativeHandle(ref, () => ({
    foldAll: () => {
      editorRef.current?.trigger("fold", "editor.foldAll", null);
    },
    unfoldAll: () => {
      editorRef.current?.trigger("unfold", "editor.unfoldAll", null);
    },
    copyToClipboard: () => copyText(jsonTextRef.current),
  }));

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    editorRef.current = monaco.editor.create(containerRef.current, {
      value: jsonTextRef.current,
      language: LANGUAGE_ID,
      automaticLayout: true,
      fontSize: codeFontSize(),
      readOnly: true,
      domReadOnly: true,
      contextmenu: false,
      cursorStyle: "block",
      cursorBlinking: "solid",
      renderLineHighlight: "none",
      selectionHighlight: false,
      occurrencesHighlight: "off",
      folding: true,
      foldingStrategy: "indentation",
      foldingHighlight: true,
      showFoldingControls: "always",
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: "off",
      glyphMargin: false,
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      quickSuggestions: false,
      parameterHints: { enabled: false },
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: "off",
      wordBasedSuggestions: "off",
      links: false,
    });

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  // Print the payload into the editor. Synchronous on purpose: the selection
  // follows a run as it happens, so this runs as often as the console repaints,
  // and an async format could land over a newer payload.
  useEffect(() => {
    const text = rawText ?? printJson(value);
    jsonTextRef.current = text;
    editorRef.current?.setValue(drawnText(text));
  }, [value, rawText]);

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full bg-background" />
    </div>
  );
});
