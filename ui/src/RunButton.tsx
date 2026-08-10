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
        running
          ? "border border-border bg-secondary text-secondary-foreground"
          : "border-none bg-[image:var(--brand-gradient)] text-white hover:brightness-110",
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
