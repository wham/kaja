import * as monaco from "monaco-editor";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { Spinner } from "./components/spinner";

export const runShortcutLabel = navigator.platform.startsWith("Mac") ? "⌘⏎" : "Ctrl+⏎";

interface RunButtonProps {
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  // Wall-clock start of the run in flight, used for the elapsed counter.
  startedAt?: number;
  // The first error stopping the run, if any. Run goes disabled and says so.
  error?: string;
}

// Run is the last control before the utility icons in the command row: the same
// 26px as everything else on it, no shadow now that it sits on a bordered row
// rather than over the code. Running keeps the button's shape and swaps its
// label for Stop.
export function RunButton({ onRun, onStop, running, startedAt, error }: RunButtonProps) {
  const elapsedMs = useElapsed(running, startedAt);
  const disabled = !running && error !== undefined;

  return (
    <button
      type="button"
      disabled={disabled}
      title={error}
      onClick={running ? onStop : onRun}
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2.5",
        running ? "border border-border bg-secondary text-secondary-foreground" : "border-none bg-emerald-600 text-white hover:bg-emerald-700",
        disabled && "cursor-default opacity-45",
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
  );
}

function useElapsed(running: boolean, startedAt?: number): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!running || startedAt === undefined) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - startedAt);
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(interval);
  }, [running, startedAt]);

  return elapsedMs;
}

// The task runner transpiles without type checking, so only a syntax error can
// stop a script from running. TypeScript numbers those below 2000; anything
// above is a semantic complaint the run doesn't care about. The same errors are
// what the switcher trigger reports, so the two never disagree.
export function useSyntaxErrors(model: monaco.editor.ITextModel | undefined): { count: number; first?: string } {
  const [errors, setErrors] = useState<{ count: number; first?: string }>({ count: 0 });

  useEffect(() => {
    if (!model) {
      setErrors({ count: 0 });
      return;
    }
    const update = () => {
      const markers = monaco.editor.getModelMarkers({ resource: model.uri }).filter((m) => m.severity === monaco.MarkerSeverity.Error && isSyntaxCode(m.code));
      setErrors({ count: markers.length, first: markers[0]?.message });
    };
    update();
    const disposable = monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((uri) => uri.toString() === model.uri.toString())) update();
    });
    return () => disposable.dispose();
  }, [model]);

  return errors;
}

function isSyntaxCode(code: monaco.editor.IMarker["code"]): boolean {
  const value = typeof code === "object" && code !== null ? code.value : code;
  const number = Number(value);
  return Number.isFinite(number) && number < 2000;
}
