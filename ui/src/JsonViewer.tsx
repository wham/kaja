import { CheckIcon, CopyIcon, FoldIcon, UnfoldIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { formatJson } from "./formatter";
import { timestampToDate, formatDateForDisplay } from "./timestampPicker";

interface JsonViewerProps {
  value: any;
  timestampPaths?: string[];
}

interface TimestampInfo {
  path: string;
  seconds: string;
  nanos: number;
}

function getValueAtPath(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function extractTimestampInfos(value: any, paths: string[]): TimestampInfo[] {
  const infos: TimestampInfo[] = [];
  for (const path of paths) {
    const ts = getValueAtPath(value, path);
    if (ts && typeof ts.seconds === "string" && typeof ts.nanos === "number") {
      infos.push({ path, seconds: ts.seconds, nanos: ts.nanos });
    }
  }
  return infos;
}

export function JsonViewer({ value, timestampPaths = [] }: JsonViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [copied, setCopied] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const codeLensProviderRef = useRef<monaco.IDisposable | null>(null);

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

  // Update Code Lens when value or timestampPaths change
  useEffect(() => {
    if (!editorRef.current || !jsonText) return;

    // Dispose previous provider
    codeLensProviderRef.current?.dispose();

    const timestampInfos = extractTimestampInfos(value, timestampPaths);
    if (timestampInfos.length === 0) return;

    // Find line numbers for each timestamp by looking for "seconds" in the JSON
    const lines = jsonText.split("\n");
    const lenses: monaco.languages.CodeLens[] = [];

    for (const info of timestampInfos) {
      // Find the line with "seconds" for this timestamp
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('"seconds"') && line.includes(`"${info.seconds}"`)) {
          const date = timestampToDate(info.seconds, info.nanos);
          const displayDate = formatDateForDisplay(date);

          lenses.push({
            range: new monaco.Range(i + 1, 1, i + 1, 1),
            command: {
              id: "",
              title: `📅 ${displayDate}`,
            },
          });
          break;
        }
      }
    }

    if (lenses.length > 0) {
      const model = editorRef.current.getModel();
      if (model) {
        codeLensProviderRef.current = monaco.languages.registerCodeLensProvider(
          { language: "javascript", pattern: model.uri.path },
          {
            provideCodeLenses: () => ({ lenses, dispose: () => {} }),
          }
        );
      }
    }

    return () => {
      codeLensProviderRef.current?.dispose();
    };
  }, [jsonText, value, timestampPaths]);

  // Create editor
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    editorRef.current = monaco.editor.create(containerRef.current, {
      value: jsonText,
      language: "javascript",
      theme: "vs-dark",
      automaticLayout: true,
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
      codeLensProviderRef.current?.dispose();
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
      <div ref={containerRef} className="json-viewer-container" style={{ height: "100%" }} />
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
