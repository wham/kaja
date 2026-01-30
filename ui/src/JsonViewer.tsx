import { CheckIcon, CopyIcon, FoldIcon, UnfoldIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { formatJson } from "./formatter";

interface JsonViewerProps {
  value: any;
}

export function JsonViewer({ value }: JsonViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [copied, setCopied] = useState(false);
  const [jsonText, setJsonText] = useState("");

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
      language: "javascript",  // Use JS instead of JSON to avoid worker errors (JSON is valid JS)
      theme: "vs-dark",
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleFoldAll = () => {
    editorRef.current?.trigger("fold", "editor.foldAll", null);
  };

  const handleUnfoldAll = () => {
    editorRef.current?.trigger("unfold", "editor.unfoldAll", null);
  };

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {/* Editor */}
      <div ref={containerRef} style={{ height: "100%" }} />
      {/* Floating toolbar */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 20,
          display: "flex",
          gap: 2,
          background: "var(--bgColor-muted)",
          borderRadius: 6,
          padding: 2,
        }}
      >
        <IconButton
          icon={FoldIcon}
          size="small"
          variant="invisible"
          aria-label="Fold all"
          onClick={handleFoldAll}
        />
        <IconButton
          icon={UnfoldIcon}
          size="small"
          variant="invisible"
          aria-label="Unfold all"
          onClick={handleUnfoldAll}
        />
        <IconButton
          icon={copied ? CheckIcon : CopyIcon}
          size="small"
          variant="invisible"
          aria-label="Copy JSON"
          onClick={handleCopy}
        />
      </div>
    </div>
  );
}
