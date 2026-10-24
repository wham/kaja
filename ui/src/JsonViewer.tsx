import * as monaco from "monaco-editor";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { copyText } from "./clipboard";
import { expandRange, valueAt } from "./jsonSelection";
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
  // A phone has no width to scroll sideways through, so lines wrap instead, and
  // no way to select in Monaco, so a long press does it.
  wrap?: boolean;
}

export interface JsonViewerHandle {
  foldAll: () => void;
  unfoldAll: () => void;
  copyToClipboard: () => Promise<boolean>;
}

export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer({ value, rawText, wrap = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const jsonTextRef = useRef("");
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

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
      cursorStyle: "line",
      cursorBlinking: "solid",
      renderLineHighlight: "none",
      selectionHighlight: false,
      renderWhitespace: "none",
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
    setEditor(editorRef.current);

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
      setEditor(null);
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({
      wordWrap: wrap ? "on" : "off",
      wrappingIndent: "indent",
      guides: { indentation: !wrap },
      lineDecorationsWidth: wrap ? 4 : 10,
      scrollbar: { horizontal: wrap ? "hidden" : "auto" },
    });
  }, [wrap]);

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
      <div ref={containerRef} className="h-full bg-background [-webkit-touch-callout:none]" />
      {wrap && editor && <PressToCopy editor={editor} containerRef={containerRef} />}
    </div>
  );
});

function expandSelection(editor: monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;
  const range = expandRange(model.getLinesContent(), {
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
  });
  editor.setSelection(new monaco.Selection(range.startLine, range.startColumn, range.endLine, range.endColumn));
}

// iOS's own selection never reaches Monaco, which draws its selection itself, so
// a long press selects the value under the finger and offers what the system
// callout would have.
const HOLD_MS = 500;
const SLOP_PX = 10;

interface PressToCopyProps {
  editor: monaco.editor.IStandaloneCodeEditor;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function PressToCopy({ editor, containerRef }: PressToCopyProps) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const selection = editor.getSelection();
    const start = selection && editor.getScrolledVisiblePosition(selection.getStartPosition());
    const end = selection && editor.getScrolledVisiblePosition(selection.getEndPosition());
    if (!start || !end) return setAnchor(null);
    const width = containerRef.current?.clientWidth ?? 0;
    const above = start.top - 40;
    setAnchor({
      top: above >= 4 ? above : end.top + end.height + 6,
      left: Math.max(8, Math.min(start.left - 8, width - (pillRef.current?.offsetWidth ?? 150) - 8)),
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let origin: { x: number; y: number } | undefined;
    let held: monaco.Selection | undefined;

    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const onStart = (event: TouchEvent) => {
      held = undefined;
      setAnchor(null);
      if (event.touches.length !== 1) return cancel();
      const touch = event.touches[0];
      origin = { x: touch.clientX, y: touch.clientY };
      timer = setTimeout(() => {
        timer = undefined;
        const model = editor.getModel();
        const position = origin && editor.getTargetAtClientPoint(origin.x, origin.y)?.position;
        if (!model || !position) return;
        const value = valueAt(model.getLineContent(position.lineNumber), position.column);
        if (value) {
          editor.setSelection(new monaco.Selection(position.lineNumber, value.start, position.lineNumber, value.end));
        } else {
          editor.setPosition(position);
          expandSelection(editor);
        }
        held = editor.getSelection() ?? undefined;
        if (held?.isEmpty()) held = undefined;
        if (held) place();
      }, HOLD_MS);
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (origin && touch && Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > SLOP_PX) cancel();
    };
    // Monaco reads any press shorter than its own hold as a tap, which collapses
    // the selection, so the selection is put back once Monaco has had it.
    const onEnd = () => {
      cancel();
      const selection = held;
      if (selection) setTimeout(() => editor.setSelection(selection));
    };

    // Captured, because Monaco's gesture handling stops touches propagating.
    container.addEventListener("touchstart", onStart, { capture: true, passive: true });
    container.addEventListener("touchmove", onMove, { capture: true, passive: true });
    container.addEventListener("touchend", onEnd, { capture: true });
    container.addEventListener("touchcancel", cancel, { capture: true });
    const scrolled = editor.onDidScrollChange(() => setAnchor(null));
    const changed = editor.onDidChangeModelContent(() => setAnchor(null));
    return () => {
      cancel();
      container.removeEventListener("touchstart", onStart, { capture: true });
      container.removeEventListener("touchmove", onMove, { capture: true });
      container.removeEventListener("touchend", onEnd, { capture: true });
      container.removeEventListener("touchcancel", cancel, { capture: true });
      scrolled.dispose();
      changed.dispose();
    };
  }, [editor, containerRef]);

  if (!anchor) return null;

  const copy = async () => {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || !(await copyText(model.getValueInRange(selection)))) return;
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setAnchor(null);
    }, 900);
  };

  const expand = () => {
    expandSelection(editor);
    place();
  };

  return (
    <div
      ref={pillRef}
      className="absolute z-10 flex overflow-hidden rounded-md border border-border bg-popover text-xs text-popover-foreground shadow-md"
      style={{ top: anchor.top, left: anchor.left }}
    >
      <button type="button" className="px-3 py-1.5 active:bg-accent" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="w-px bg-border" />
      <button type="button" className="px-3 py-1.5 active:bg-accent" onClick={expand}>
        Expand
      </button>
    </div>
  );
}
