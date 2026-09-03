import { useSyncExternalStore, useState } from "react";
import { CircleAlert, Copy, Check } from "lucide-react";
import { AppError, clearAppErrors, getAppErrors, subscribeAppErrors } from "./appErrors";
import { formatClockTime } from "./callTime";
import { copyText } from "./clipboard";
import { Button } from "./components/button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";

const ICON_SIZE = 14;

// The popover draws the recent ones and the copy takes them all: a list long enough to
// scroll is a log, and the place to read a log is the file the copy pastes into.
const VISIBLE_ERRORS = 8;

// The headline is the first line; a stack is the rest. Splitting here rather than in
// the store keeps `AppError.message` the one string the copy writes out.
function headline(error: AppError): string {
  const end = error.message.indexOf("\n");
  return end === -1 ? error.message : error.message.slice(0, end);
}

function detail(error: AppError): string | undefined {
  const end = error.message.indexOf("\n");
  return end === -1 ? undefined : error.message.slice(end + 1).trim() || undefined;
}

/**
 * What has been reported, newest first.
 *
 * The footer asks as well, because an item that draws nothing still has a separator
 * drawn beside it — the same reason the bar asks `summarizeCompilation` before it
 * pushes the compile status.
 */
export function useAppErrors(): readonly AppError[] {
  return useSyncExternalStore(subscribeAppErrors, getAppErrors, getAppErrors);
}

function ErrorRow({ error }: { error: AppError }) {
  const [expanded, setExpanded] = useState(false);
  const stack = detail(error);

  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-accent">
      <button
        type="button"
        disabled={!stack}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start gap-2 text-left disabled:cursor-default"
      >
        <CircleAlert size={ICON_SIZE} className="mt-px shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 break-words text-xs text-foreground">{headline(error)}</span>
        {error.count > 1 && <span className="shrink-0 rounded bg-muted px-1 pt-px text-[11px] tabular-nums text-muted-foreground">×{error.count}</span>}
        <span className="shrink-0 pt-px font-mono text-[11px] tabular-nums text-muted-foreground">{formatClockTime(error.at)}</span>
      </button>
      {expanded && stack && (
        <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-words pl-[22px] font-mono text-[11px] leading-4 text-muted-foreground">
          {stack}
        </pre>
      )}
    </div>
  );
}

/**
 * What Kaja failed at, in the footer.
 *
 * Absent while there is nothing to say, the way `CompileStatus` is absent with no
 * apps: a permanent `0` is a promise that a number is coming, and in most sessions it
 * never does. It does not open itself either — an error arrives while you are working
 * on something else, and a panel over that work is a worse interruption than a red
 * count in the corner.
 */
export function ErrorStatus() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const errors = useAppErrors();

  if (errors.length === 0) return null;

  // What the footer counts is reports, not rows, so a repeat that collapsed into one
  // row still says how much went wrong.
  const total = errors.reduce((sum, error) => sum + error.count, 0);
  const label = `${total} error${total === 1 ? "" : "s"}`;

  const copyAll = async () => {
    const text = errors.map((error) => `${formatClockTime(error.at)}${error.count > 1 ? ` (×${error.count})` : ""} ${error.message}`).join("\n\n");
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const clearAll = () => {
    setOpen(false);
    clearAppErrors();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}, open the error log`}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs text-destructive transition-colors hover:bg-accent"
        >
          <CircleAlert size={ICON_SIZE} className="shrink-0" />
          <span aria-live="polite" className="tabular-nums">
            {total}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[380px] p-1">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold text-foreground">Errors</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={copyAll}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {errors.slice(0, VISIBLE_ERRORS).map((error, index) => (
            <ErrorRow key={`${error.at}-${index}`} error={error} />
          ))}
        </div>
        {errors.length > VISIBLE_ERRORS && (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{errors.length - VISIBLE_ERRORS} more in the copy</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
