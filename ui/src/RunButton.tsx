import { ChevronDown, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/dropdown-menu";
import { Spinner } from "./components/spinner";

const isMac = navigator.platform.startsWith("Mac");

export const runShortcutLabel = isMac ? "⌘⏎" : "Ctrl+⏎";
export const runWithParametersShortcutLabel = isMac ? "⇧⌘⏎" : "Ctrl+Shift+⏎";
export const copyDeeplinkShortcutLabel = isMac ? "⌘⇧C" : "Ctrl+Shift+C";

interface RunButtonProps {
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  // Wall-clock start of the run in flight, used for the elapsed counter.
  startedAt?: number;
  // The first error stopping the run, if any. Run goes disabled and says so.
  error?: string;
  // The second gesture, and the whole reason there is a caret: this file reads
  // `kaja.input`, so there is something to ask for before it runs. A script
  // that reads nothing gets a bare Run button, as before.
  onRunWithParameters?: () => void;
  // A file's address outside Kaja. Absent on a draft, which has none, and on
  // the web, which can't register a scheme.
  onCopyDeeplink?: () => void;
}

// Run is the last control before the utility icons in the command row: the same
// 26px as everything else on it, no shadow now that it sits on a bordered row
// rather than over the code. Running keeps the button's shape and swaps its
// label for Stop.
//
// Plain Run keeps its place and its ⌘⏎ — the one-click path is untouched. The
// caret beside it is where the gestures that need a sheet first live, so
// pressing Run never opens anything.
export function RunButton({ onRun, onStop, running, startedAt, error, onRunWithParameters, onCopyDeeplink }: RunButtonProps) {
  const elapsedMs = useElapsed(running, startedAt);
  const disabled = !running && error !== undefined;
  // Mid-run the button is Stop, which is one thing to press and nothing to
  // choose between.
  const split = !running && onRunWithParameters !== undefined;

  return (
    <div
      className={cn(
        "flex h-[26px] shrink-0 items-stretch overflow-hidden rounded-md",
        running ? "border border-border bg-secondary text-secondary-foreground" : "bg-emerald-600 text-white",
        disabled && "opacity-45",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        title={error}
        onClick={() => (running ? onStop() : onRun())}
        className={cn("flex items-center gap-1.5 px-2.5", !running && !disabled && "hover:bg-emerald-700", disabled && "cursor-default")}
      >
        {running ? <Spinner className="size-[13px] text-muted-foreground" /> : <Play size={13} />}
        <span className="text-xs font-medium">{running ? "Stop" : "Run"}</span>
        {running ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{(elapsedMs / 1000).toFixed(1)}s</span>
        ) : (
          // The hint is the first thing to go as the command row narrows: the
          // screens that narrow it that far have no keyboard to press.
          !disabled && <span className="font-mono text-xs opacity-70 @max-[380px]:hidden">{runShortcutLabel}</span>
        )}
      </button>
      {split && (
        <>
          <div className="w-px bg-black/25" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label="More run options"
                className={cn("flex w-[22px] items-center justify-center", !disabled && "hover:bg-emerald-700", disabled && "cursor-default")}
              >
                <ChevronDown size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[260px]">
              <DropdownMenuItem onSelect={() => onRun()}>
                <span className="flex-1">Run</span>
                <Shortcut label={runShortcutLabel} />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRunWithParameters()}>
                <span className="flex-1">Run with parameters…</span>
                <Shortcut label={runWithParametersShortcutLabel} />
              </DropdownMenuItem>
              {/* The same sheet with the URL line, so the three doors sit in
                  one menu and read as one feature. */}
              {onCopyDeeplink && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onCopyDeeplink()}>
                    <span className="flex-1">Copy deeplink…</span>
                    <Shortcut label={copyDeeplinkShortcutLabel} />
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}

function Shortcut({ label }: { label: string }) {
  return <span className="shrink-0 font-mono text-xs text-muted-foreground">{label}</span>;
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
