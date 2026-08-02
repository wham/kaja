import * as monaco from "monaco-editor";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Spinner } from "./components/spinner";

// Distance from the editor's top-right corner. The right offset grows by the
// scrollbar width when the editor scrolls, so the button never sits on the track.
const TOP_OFFSET = 10;
const RIGHT_OFFSET = 16;
// The button dims while typing so it doesn't sit in the way of the code, and
// comes back once the cursor rests.
const DIM_OPACITY = 0.55;
const IDLE_DELAY = 800;

export const runShortcutLabel = navigator.platform.startsWith("Mac") ? "⌘⏎" : "Ctrl+⏎";

interface RunButtonProps {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  model: monaco.editor.ITextModel;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  // Wall-clock start of the run in flight, used for the elapsed counter.
  startedAt?: number;
}

// RunButton floats over the editor's top-right corner: it costs no layout, stays
// with the document it runs, and carries the run's state in place — Run becomes
// Stop with a spinner and an elapsed counter while a script is in flight.
export function RunButton({ editor, model, onRun, onStop, running, startedAt }: RunButtonProps) {
  const [rightOffset, setRightOffset] = useState(RIGHT_OFFSET);
  const [dimmed, setDimmed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const syntaxError = useSyntaxError(model);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const layout = editor.getLayoutInfo();
      const scrolls = editor.getContentHeight() > layout.height;
      setRightOffset(RIGHT_OFFSET + (scrolls ? layout.verticalScrollbarWidth : 0));
    };
    update();
    const disposables = [editor.onDidContentSizeChange(update), editor.onDidLayoutChange(update)];
    return () => disposables.forEach((d) => d.dispose());
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const wake = () => {
      clearTimeout(idleTimer.current);
      setDimmed(false);
    };
    const disposables = [
      editor.onDidChangeModelContent(() => {
        // Only a real keystroke dims it; programmatic edits (formatting on open,
        // a reload from disk) leave it alone.
        if (!editor.hasTextFocus()) return;
        setDimmed(true);
        clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setDimmed(false), IDLE_DELAY);
      }),
      editor.onDidBlurEditorText(wake),
    ];
    return () => {
      clearTimeout(idleTimer.current);
      disposables.forEach((d) => d.dispose());
    };
  }, [editor]);

  useEffect(() => {
    if (!running || startedAt === undefined) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - startedAt);
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(interval);
  }, [running, startedAt]);

  const disabled = !running && syntaxError !== undefined;
  const opacity = running || hovered ? 1 : disabled ? 0.45 : dimmed ? DIM_OPACITY : 1;

  return (
    <div
      className="absolute z-10 transition-opacity duration-[120ms]"
      style={{ top: TOP_OFFSET, right: rightOffset, opacity }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        disabled={disabled}
        title={disabled ? syntaxError : undefined}
        onClick={running ? onStop : onRun}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 shadow-md",
          running ? "border border-border bg-secondary text-secondary-foreground" : "border-none bg-emerald-600 text-white hover:bg-emerald-700",
          disabled && "cursor-default",
        )}
      >
        {running ? <Spinner className="size-[13px] text-muted-foreground" /> : <Play size={13} />}
        <span className="text-xs font-medium">{running ? "Stop" : "Run"}</span>
        {running ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{(elapsedMs / 1000).toFixed(1)}s</span>
        ) : (
          !disabled && <span className="font-mono text-xs opacity-70">{runShortcutLabel}</span>
        )}
      </button>
    </div>
  );
}

// The task runner transpiles without type checking, so only a syntax error can
// stop a script from running. TypeScript numbers those below 2000; anything
// above is a semantic complaint the run doesn't care about.
function useSyntaxError(model: monaco.editor.ITextModel): string | undefined {
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const update = () => {
      const marker = monaco.editor.getModelMarkers({ resource: model.uri }).find((m) => m.severity === monaco.MarkerSeverity.Error && isSyntaxCode(m.code));
      setMessage(marker?.message);
    };
    update();
    const disposable = monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((uri) => uri.toString() === model.uri.toString())) update();
    });
    return () => disposable.dispose();
  }, [model]);

  return message;
}

function isSyntaxCode(code: monaco.editor.IMarker["code"]): boolean {
  const value = typeof code === "object" && code !== null ? code.value : code;
  const number = Number(value);
  return Number.isFinite(number) && number < 2000;
}
