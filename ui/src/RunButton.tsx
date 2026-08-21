import { ChevronDown, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/dropdown-menu";
import { Spinner } from "./components/spinner";

const isMac = navigator.platform.startsWith("Mac");

export const runShortcutLabel = isMac ? "⌘⏎" : "Ctrl+⏎";
export const runWithParametersShortcutLabel = isMac ? "⇧⌘⏎" : "Ctrl+Shift+⏎";
export const copyDeeplinkShortcutLabel = isMac ? "⌘⇧C" : "Ctrl+Shift+C";
export const nameShortcutLabel = isMac ? "⌘S" : "Ctrl+S";

interface RunButtonProps {
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  // Wall-clock start of the run in flight, used for the elapsed counter.
  startedAt?: number;
  // The first error stopping the run, if any. Run goes disabled and says so.
  error?: string;
  // The second gesture: this file reads `kaja.input`, so there is something to
  // ask for before it runs. Omitted rather than disabled on a script that reads
  // nothing — a greyed item makes people hunt for the way to enable it.
  onRunWithParameters?: () => void;
  // A file's address outside Kaja. Absent on the web, which can't register a
  // scheme.
  onCopyDeeplink?: () => void;
  // The file itself, on the disk this process owns.
  onRevealInFinder?: () => void;
  // What a draft has instead of an address: the sheet that gives it one, and
  // the discard that closes the buffer. Absent on a file, which is already on
  // disk and stays there as you type.
  onNameDraft?: () => void;
  onDiscardDraft?: () => void;
  // A read-only file's only route to a copy you can change. Absent wherever a
  // file can simply be copied to another file.
  onDuplicateAsDraft?: () => void;
}

// Run is the last control before the utility icons in the command row: the same
// 26px as everything else on it, no shadow now that it sits on a bordered row
// rather than over the code. Running keeps the button's shape and swaps its
// label for Stop.
//
// Plain Run keeps its place and its ⌘⏎ — the one-click path is untouched. The
// caret beside it is where the gestures that need a sheet first live, so
// pressing Run never opens anything.
//
// The caret is the script's action menu rather than a parameters affordance, so
// it is on for every script and the menu is what varies. Keying it to
// `kaja.input` instead is what made the pill two widths: it stepped 23px wider
// the moment you moved from a script that declares a key to one that doesn't,
// which is a control moving under the cursor for a reason nothing on screen
// explains — and it also left `Copy deeplink…` in a menu that a file with no
// parameters had no way to open.
//
// What fills the second group is what this script is once the run is over, and
// every script has an answer to that: a file offers the address it has, a draft
// offers the sheet that gives it one. That is why the group is never empty and
// the caret never has to disappear.
export function RunButton({
  onRun,
  onStop,
  running,
  startedAt,
  error,
  onRunWithParameters,
  onCopyDeeplink,
  onRevealInFinder,
  onNameDraft,
  onDiscardDraft,
  onDuplicateAsDraft,
}: RunButtonProps) {
  const elapsedMs = useElapsed(running, startedAt);
  const disabled = !running && error !== undefined;
  // What the second group holds, which decides whether there is a separator
  // above it.
  const aboutTheScript = [onCopyDeeplink, onRevealInFinder, onNameDraft, onDiscardDraft, onDuplicateAsDraft].some(Boolean);
  // Mid-run the button is Stop, which is one thing to press and nothing to
  // choose between. Otherwise the caret is on whenever the menu says more than
  // the button already does — which, by the rule above, is always.
  const split = !running && (aboutTheScript || onRunWithParameters !== undefined);

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
              {onRunWithParameters && (
                <DropdownMenuItem onSelect={() => onRunWithParameters()}>
                  <span className="flex-1">Run with parameters…</span>
                  <Shortcut label={runWithParametersShortcutLabel} />
                </DropdownMenuItem>
              )}
              {aboutTheScript && <DropdownMenuSeparator />}
              {/* The same sheet with the URL line, so the three doors sit in
                  one menu and read as one feature. */}
              {onCopyDeeplink && (
                <DropdownMenuItem onSelect={() => onCopyDeeplink()}>
                  <span className="flex-1">Copy deeplink…</span>
                  <Shortcut label={copyDeeplinkShortcutLabel} />
                </DropdownMenuItem>
              )}
              {onRevealInFinder && (
                <DropdownMenuItem onSelect={() => onRevealInFinder()}>
                  <span className="flex-1">Reveal in Finder</span>
                </DropdownMenuItem>
              )}
              {/* A draft's counterpart to the address a file has: it has no
                  deeplink because it has no name, and this is the sheet that
                  fixes that. */}
              {onNameDraft && (
                <DropdownMenuItem onSelect={() => onNameDraft()}>
                  <span className="flex-1">Name…</span>
                  <Shortcut label={nameShortcutLabel} />
                </DropdownMenuItem>
              )}
              {onDiscardDraft && (
                <DropdownMenuItem onSelect={() => onDiscardDraft()}>
                  <span className="flex-1">Discard</span>
                </DropdownMenuItem>
              )}
              {onDuplicateAsDraft && (
                <DropdownMenuItem onSelect={() => onDuplicateAsDraft()}>
                  <span className="flex-1">Duplicate as draft</span>
                </DropdownMenuItem>
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
