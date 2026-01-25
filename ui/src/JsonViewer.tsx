import { CopyIcon, CheckIcon, FoldIcon, UnfoldIcon } from "@primer/octicons-react";
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
      language: "json",
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
      <style>{`
        .json-viewer-container .monaco-editor,
        .json-viewer-container .monaco-editor-background,
        .json-viewer-container .monaco-editor .margin {
          background-color: #0d1117 !important;
        }
      `}</style>
      {/* Editor */}
      <div ref={containerRef} className="json-viewer-container" style={{ height: "100%" }} />
      {/* Floating toolbar */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 20,
          display: "flex",
          gap: 2,
          background: "rgba(13, 17, 23, 0.8)",
          borderRadius: 6,
          padding: 2,
        }}
      >
        <ToolbarButton onClick={handleFoldAll} title="Fold all">
          <FoldIcon size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={handleUnfoldAll} title="Unfold all">
          <UnfoldIcon size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={handleCopy} title="Copy JSON">
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </ToolbarButton>
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, title, children }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "transparent",
        border: "none",
        padding: "4px 6px",
        cursor: "pointer",
        color: "var(--fgColor-muted)",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--bgColor-neutral-muted)";
        e.currentTarget.style.color = "var(--fgColor-default)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--fgColor-muted)";
      }}
    >
      {children}
    </button>
  );
}
