import { CircleAlert, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApproveBlock, AskBlock, Block } from "../blocks";
import { Button } from "../components/button";
import { Canvas } from "../Canvas";
import { cn } from "../cn";
import { consoles } from "../consoles";
import { ApprovalRejectedError, ApproveDecision, AskCancelledError, KajaHost, MethodCall } from "../kaja";
import { KajaTrace } from "../KajaTrace";
import { newRunId, Run } from "../runs";
import { CellRef, TableView } from "../tableView";
import { LogLevel } from "../server/api";
import { LoadedBundle } from "./bundle";
import { resolveBindings, runBundledScript } from "./runtime";

/**
 * An exported script, running on its own.
 *
 * There is one file, one script and one canvas, so almost everything the app
 * this came from puts around a run — the tree, the editor, the finder, the run
 * picker, the two views of a run — has nothing to be about here. What is left is
 * the canvas, and a button that starts the thing again.
 *
 * The canvas itself is the same component, over the same store. A table pages,
 * a cell fills in, a question waits, an approve block holds a call back — all of
 * it works here because none of it was ever about the editor.
 */
export function Player({ bundle }: { bundle: LoadedBundle }) {
  const manifest = bundle.state.manifest;
  // One file, named for the script. The store is keyed by file, so this is the
  // whole of what makes the run land somewhere it can be read back.
  const fileId = manifest.name;

  const [run, setRun] = useState<{ id: string; controller: AbortController; settled: boolean } | null>(null);
  const [tableViews, setTableViews] = useState<{ [blockId: string]: TableView }>({});

  const version = useSyncExternalStore(
    useCallback((listener) => consoles.subscribeFile(fileId, listener), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );

  const pendingPromptsRef = useRef(new Map<string, { resolve: (answer: string) => void; reject: (error: unknown) => void }>());

  // What outlives a run: the workspace's variables, and the live tables, which
  // are paged long after the run that drew them is over. One `Kaja` is made per
  // run off this, so a page fetched later lands in the log of the run that drew
  // the table rather than in a run of its own.
  const hostRef = useRef<KajaHost>(null);
  if (!hostRef.current) {
    hostRef.current = new KajaHost();
    // A script reads the values where it runs. The runner sends them only when
    // nobody else can be looking at this page — everywhere else they stay in the
    // process, which is the rule the web server has always followed.
    hostRef.current.variables = bundle.state.variables ?? {};
  }
  const host = hostRef.current;

  // The clients are the apps', not a run's: built once, bound per run.
  const bindings = useMemo(() => resolveBindings(bundle), [bundle]);

  const start = useCallback(() => {
    const controller = new AbortController();
    const started: Run = { id: newRunId(), title: manifest.title ?? manifest.name, fileId, startedAt: Date.now() };
    consoles.startRun(started, started.startedAt);
    setRun({ id: started.id, controller, settled: false });
    setTableViews({});

    const kaja = host.run({
      // A link's parameters are this app's arguments: the same `kaja.input` a
      // kaja://run link fills, from the query string of the page it was opened
      // at. It is given at the start rather than assigned afterwards, so one
      // run can never find what another was handed.
      input: Object.fromEntries(new URLSearchParams(window.location.search)),
      onMethodCallUpdate: (methodCall: MethodCall) => consoles.recordCall(fileId, started.id, methodCall, Date.now()),
      onLog: (level: LogLevel, message: string) => consoles.recordPrinted(fileId, started.id, level, message, Date.now()),
      onBlockUpdate: (blockId: string, block: Block) => consoles.recordBlock(fileId, started.id, blockId, block, Date.now()),
      onAsk: (_question: AskBlock, blockId: string) =>
        new Promise<string>((resolve, reject) => {
          pendingPromptsRef.current.set(blockId, { resolve, reject });
        }),
      onApprove: (_call: ApproveBlock, blockId: string) =>
        new Promise<ApproveDecision>((resolve, reject) => {
          pendingPromptsRef.current.set(blockId, {
            resolve: (gesture) => resolve(gesture === "all" ? "all" : "approved"),
            reject,
          });
        }),
    });

    const onError = (error: unknown) => {
      const message = error instanceof Error ? (error.name === "Error" ? error.message : `${error.name}: ${error.message}`) : String(error);
      consoles.recordLogs(fileId, started.id, [{ level: LogLevel.LEVEL_ERROR, message }], Date.now());
    };

    // A live table draws its first page itself, and those calls are the run's:
    // the script is not over until they have landed, or the run would report a
    // duration that stops before the work it started.
    runBundledScript(bundle, bindings, kaja, onError, controller.signal)
      .then(() => kaja.settleTables())
      .finally(() => {
        setRun((current) => (current?.controller === controller ? { ...current, settled: true } : current));
      });
  }, [bindings, bundle, fileId, host, manifest.name, manifest.title]);

  /**
   * A run is over. Settling is what gives it its wall duration, and it is done
   * once per run: the store reports every change, and settling is itself a
   * change, so a run settled on sight of one would settle on sight of its own.
   */
  const settledRef = useRef<string | null>(null);
  const endRun = useCallback(
    (runId: string) => {
      if (settledRef.current === runId) return;
      settledRef.current = runId;
      const now = Date.now();
      const startedAt = consoles.file(fileId).runs.find((held) => held.id === runId)?.startedAt ?? now;
      consoles.settleRun(fileId, runId, now - startedAt, now);
    },
    [fileId],
  );

  /**
   * Stop ends the run, rather than asking the script to end it. Waiting for the
   * script to unwind is waiting on the thing that was stopped: a run parked on a
   * question that will never be asked again has nothing left to settle it, and
   * one sleeping between two calls settles whenever it feels like it. So the run
   * is ended here, which is what stops the mark in the bar.
   */
  const stop = useCallback(() => {
    if (!run) return;
    run.controller.abort();
    // A run parked on a question is waiting rather than calling, so stopping it
    // is answering nothing rather than aborting something.
    for (const [, pending] of pendingPromptsRef.current) pending.reject(new AskCancelledError());
    pendingPromptsRef.current.clear();
    endRun(run.id);
    setRun(null);
  }, [endRun, run]);

  // Left to itself, a run is over once the script has settled and nothing it
  // started is still in flight — a call, or a question it is parked on.
  useEffect(() => {
    if (!run?.settled) return;
    if (consoles.hasWorkInFlight(fileId, run.id)) return;
    endRun(run.id);
  }, [endRun, fileId, run, version]);

  const startedRef = useRef(false);
  useEffect(() => {
    // A script that only reads is worth running on sight. One that holds a call
    // back for approval is exported with this off, because running it would
    // answer the question the block exists to ask.
    if (startedRef.current || !manifest.runOnLoad) return;
    startedRef.current = true;
    start();
  }, [manifest.runOnLoad, start]);

  const settlePrompt = useCallback((blockId: string, settle: (pending: { resolve: (answer: string) => void; reject: (error: unknown) => void }) => void) => {
    const pending = pendingPromptsRef.current.get(blockId);
    if (!pending) return;
    pendingPromptsRef.current.delete(blockId);
    settle(pending);
  }, []);

  const onTablePull = useCallback(
    async (blockId: string, search: string, want: number) => {
      const found = consoles.findBlock(blockId);
      const table = found?.block;
      if (!found || table?.kind !== "table") return;
      const live = await host.pullTable(blockId, search, want);
      if (!live) consoles.recordBlock(found.fileId, found.run.id, blockId, { ...table, live: false, expired: true }, Date.now());
    },
    [host],
  );

  const onTableCells = useCallback(
    async (blockId: string, cells: CellRef[]) => {
      const found = consoles.findBlock(blockId);
      const table = found?.block;
      if (!found || table?.kind !== "table") return;
      const held = await host.pullCells(blockId, cells);
      if (!held) consoles.recordBlock(found.fileId, found.run.id, blockId, { ...table, expired: true }, Date.now());
    },
    [host],
  );

  const file = consoles.file(fileId);
  const latest = file.runs[0];
  const group = latest ? file.group(latest.id) : undefined;
  const running = !!group?.running;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-chrome px-3">
        <span className="truncate text-sm font-medium">{manifest.title ?? manifest.name}</span>
        {running ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <KajaTrace running />
            <span>Running</span>
          </span>
        ) : null}
        <div className="flex-1" />
        <Problems bundle={bundle} />
        <Button size="sm" variant={running ? "secondary" : "default"} onClick={running ? stop : start}>
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? "Stop" : "Run"}
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {group ? (
          <div className="flex h-full flex-col">
            {group.strip.calls > 0 && <Canvas.RunStrip group={group} onSelectCall={() => {}} />}
            <div className="min-h-0 flex-1">
              <Canvas
                group={group}
                // The exported app *is* the full-screen canvas — the whole window
                // with one document in it — so it is drawn as one: 32px of air,
                // and text measured at 72ch rather than at the width of a panel
                // that is a third of a window here.
                fullScreen
                onAnswer={(blockId, answer) => settlePrompt(blockId, (pending) => pending.resolve(answer))}
                onCancelAsk={(blockId) => settlePrompt(blockId, (pending) => pending.reject(new AskCancelledError()))}
                onDecide={(blockId, gesture) =>
                  settlePrompt(blockId, (pending) => (gesture === "rejected" ? pending.reject(new ApprovalRejectedError()) : pending.resolve(gesture)))
                }
                onSelectCall={() => {}}
                tableViews={tableViews}
                onTableView={(blockId, view) => setTableViews((views) => ({ ...views, [blockId]: view }))}
                onTablePull={onTablePull}
                onTableCells={onTableCells}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {manifest.runOnLoad ? "Starting…" : "Press Run."}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What is wrong before anything is pressed. An exported app is met by somebody
 * who did not export it, on a machine that is not the one it was exported on, so
 * the two things that can be missing — a variable's value, and an app that
 * wouldn't open — are said up front rather than discovered as a call that fails
 * for no stated reason.
 */
function Problems({ bundle }: { bundle: LoadedBundle }) {
  const [open, setOpen] = useState(false);
  const missing = bundle.state.missingVariables ?? [];
  const failed = bundle.state.apps.filter((app) => app.error);
  const count = missing.length + failed.length;
  if (count === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((open) => !open)}
        className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs", "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400")}
      >
        <CircleAlert size={12} />
        {count === 1 ? "1 problem" : `${count} problems`}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-96 rounded-md border border-border bg-popover p-3 text-xs shadow-lg">
          <ul className="space-y-2">
            {missing.map((name) => {
              const variable = bundle.state.manifest.variables?.find((variable) => variable.name === name);
              return (
                <li key={name}>
                  <span className="font-medium">{name}</span> has no value here — set{" "}
                  <code className="rounded bg-muted px-1 py-0.5">{variable?.env ?? `KAJA_${name}`}</code> and start this again.
                </li>
              );
            })}
            {failed.map((app) => (
              <li key={app.name}>
                <span className="font-medium">{app.name}</span> didn&rsquo;t open: {app.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
