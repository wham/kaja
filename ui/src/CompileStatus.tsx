import { useEffect, useRef, useState } from "react";
import { Check, CircleX, RotateCw, TriangleAlert } from "lucide-react";
import { cn } from "./cn";
import { App } from "./apps";
import { appType } from "./appTypes";
import { AppPill } from "./Sidebar";
import { IconButton } from "./components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { Spinner } from "./components/spinner";
import { appWarnings, countMethods, firstErrorMessage, isCompiling, settledLabel, summarizeCompilation, visibleTarget, CompileState } from "./compileSummary";

// How long the green receipt stays up after a batch settles, before the
// indicator falls back to its resting label.
const RECEIPT_MS = 3000;

const ICON_SIZE = 14;

interface CompileStatusProps {
  apps: App[];
  configurationLoaded: boolean;
  // Opens the compile log, expanded on the given app.
  onShowLog: (appName?: string) => void;
  // Recompiles one app, or every app when no name is given.
  onRecompile: (appName?: string) => void;
}

// A state that carries a colour keeps it on hover; the quiet ones lift to the
// foreground the way the rest of the footer does.
const stateClass: Record<CompileState, string> = {
  empty: "",
  loading: "text-muted-foreground hover:text-foreground",
  compiling: "text-muted-foreground hover:text-foreground",
  ready: "text-muted-foreground hover:text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
};

function StateIcon({ state }: { state: CompileState }) {
  if (state === "loading" || state === "compiling") return <Spinner size="sm" className="size-[14px] text-current" />;
  if (state === "failed") return <CircleX size={ICON_SIZE} />;
  if (state === "warning") return <TriangleAlert size={ICON_SIZE} />;
  return <Check size={ICON_SIZE} />;
}

// AppRow is the app as the popover states it: what it is, where it points, and
// what came of compiling it. Selecting it opens the log.
function AppRow({ app, onShowLog, onRecompile }: { app: App; onShowLog: () => void; onRecompile: () => void }) {
  const [hovered, setHovered] = useState(false);
  const status = app.compilation.status;
  const warnings = appWarnings(app);

  const detail = () => {
    if (status === "error") {
      return <span className="text-destructive">{firstErrorMessage(app) ?? "Compilation failed"}</span>;
    }
    if (isCompiling(app)) {
      return <span>{status === "pending" ? "Waiting…" : "Compiling…"}</span>;
    }
    const counts = `${app.services.length} service${app.services.length === 1 ? "" : "s"}, ${countMethods(app)} method${countMethods(app) === 1 ? "" : "s"}`;
    const target = visibleTarget(app);
    return <span>{target ? `${target} · ${counts}` : counts}</span>;
  };

  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        data-testid="app-status-row"
        onClick={onShowLog}
        className="flex w-full items-start gap-2 rounded-md py-1.5 pl-2 pr-9 text-left hover:bg-accent"
      >
        <span className="mt-px flex size-[14px] shrink-0 items-center justify-center">
          {isCompiling(app) ? (
            <Spinner size="sm" className="size-[14px]" />
          ) : status === "error" ? (
            <CircleX size={ICON_SIZE} className="text-destructive" />
          ) : warnings.length > 0 ? (
            <TriangleAlert size={ICON_SIZE} className="text-amber-600 dark:text-amber-400" />
          ) : (
            <Check size={ICON_SIZE} className="text-emerald-600 dark:text-emerald-400" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center">
            <span className="truncate text-xs font-medium text-foreground">{app.configuration.name}</span>
            <AppPill type={appType(app.configuration)} />
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{detail()}</span>
        </span>
        {!hovered && app.compilation.duration && <span className="shrink-0 pt-px text-[11px] text-muted-foreground">{app.compilation.duration}</span>}
      </button>
      {/* Outside the row button: a button can't nest another one. */}
      {hovered && (
        <IconButton
          size="xs"
          variant="ghost"
          tooltip={false}
          icon={RotateCw}
          aria-label={`Recompile ${app.configuration.name}`}
          className="absolute right-2 top-1.5"
          onClick={onRecompile}
        />
      )}
    </div>
  );
}

// CompileStatus rolls the compile state of every app into one footer item, and
// keeps the detail — per app, and the logs behind it — one click away.
export function CompileStatus({ apps, configurationLoaded, onShowLog, onRecompile }: CompileStatusProps) {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<string>();
  const summary = summarizeCompilation(apps, configurationLoaded);

  const batchStart = useRef<number | undefined>(undefined);
  const wasCompiling = useRef(false);
  useEffect(() => {
    if (summary.compiling > 0) {
      if (!wasCompiling.current) {
        batchStart.current = Date.now();
        wasCompiling.current = true;
      }
      setReceipt(undefined);
      return;
    }
    if (!wasCompiling.current) return;
    wasCompiling.current = false;
    if (summary.state !== "ready" || batchStart.current === undefined) return;
    setReceipt(settledLabel(apps, Date.now() - batchStart.current));
    const timer = setTimeout(() => setReceipt(undefined), RECEIPT_MS);
    return () => clearTimeout(timer);
  }, [summary.compiling, summary.state]);

  // A failure asks for attention exactly once: the popover opens itself when an
  // app that wasn't failing starts to, and only after the batch has settled, so
  // it doesn't appear mid-compile. A recompile of an unrelated app leaves it
  // alone.
  const failedNames = apps.filter((app) => app.compilation.status === "error").map((app) => app.configuration.name);
  const failedKey = failedNames.join(",");
  const seenFailures = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (summary.compiling > 0) return;
    const isNew = failedNames.some((name) => !seenFailures.current.has(name));
    seenFailures.current = new Set(failedNames);
    if (isNew) setOpen(true);
  }, [failedKey, summary.compiling]);

  if (summary.state === "empty") return null;

  const settled = receipt !== undefined;
  const label = receipt ?? summary.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}, open app status`}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded px-1.5 text-xs transition-colors hover:bg-accent",
            settled ? "text-emerald-600 dark:text-emerald-400" : stateClass[summary.state],
          )}
        >
          <StateIcon state={settled ? "ready" : summary.state} />
          <span aria-live="polite">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[360px] p-1">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold text-foreground">Apps</span>
          <IconButton size="xs" variant="ghost" tooltip={false} icon={RotateCw} aria-label="Recompile all" onClick={() => onRecompile()} />
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {apps.map((app) => (
            <AppRow
              key={app.configuration.name}
              app={app}
              onShowLog={() => {
                setOpen(false);
                onShowLog(app.configuration.name);
              }}
              onRecompile={() => onRecompile(app.configuration.name)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
