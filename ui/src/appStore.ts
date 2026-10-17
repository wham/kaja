import { loadApp } from "./appLoader";
import { App, createPendingApp, isReady } from "./apps";
import { countWarnings, firstErrorLine } from "./compileSummary";
import { matchesStored, storeManifest, StoredManifest } from "./manifestCache";
import { CompileRequest, CompileResponse, CompileStatus, Log, LogLevel, WorkspaceApp } from "./server/api";
import { getApiClient } from "./server/connection";
import { parseManifest } from "./sources";
import { deviceConsole } from "./uiLog";

/**
 * Every app the window holds, as a store rather than React state, for the reason the
 * console is one (consoles.ts): a compile is a stream of log lines, and each one
 * written into state at the root of the window rendered the whole window.
 *
 * Two things are kept apart. The **surface** is the list of apps as compiled —
 * configuration, services, clients, sources, reflection and the status the rest of
 * the window reads — and it moves when an app compiles, is added, removed, renamed
 * or remapped, and at no other time. The **progress** is what the compiler has said
 * about one app so far, its log above all, and it moves once per line. The compile
 * log reads the second; the root reads the first.
 */

export type Compiler = (request: CompileRequest, signal: AbortSignal) => AsyncIterable<CompileResponse>;

export interface CompileProgress {
  // The compiler is at work on this app, whatever its surface says: a surface read
  // back from the last session stays on screen while the server reopens the app
  // under it.
  running: boolean;
  logs: Log[];
}

const IDLE: CompileProgress = { running: false, logs: [] };

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

const defaultCompiler: Compiler = (request, signal) => getApiClient().compile(request, { abort: signal }).responses;

export class AppStore {
  #apps: App[] = [];
  readonly #progress = new Map<string, CompileProgress>();
  // The manifest text each surface was built from, which is what a fresh compile is
  // compared against before the surface is replaced.
  readonly #manifests = new Map<string, string>();
  readonly #startedAt = new Map<string, number>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #surfaceListeners = new Set<() => void>();
  readonly #progressListeners = new Set<() => void>();
  #progressVersion = 0;
  #scheduled = false;
  // Overridable so tests can compile without a server.
  compiler: Compiler = defaultCompiler;

  subscribe = (listener: () => void): (() => void) => {
    this.#surfaceListeners.add(listener);
    return () => this.#surfaceListeners.delete(listener);
  };

  getSnapshot = (): App[] => this.#apps;

  subscribeProgress = (listener: () => void): (() => void) => {
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  };

  progressVersion = (): number => this.#progressVersion;

  progressOf(name: string): CompileProgress {
    return this.#progress.get(name) ?? IDLE;
  }

  app(name: string): App | undefined {
    return this.#apps.find((app) => app.configuration.name === name);
  }

  /**
   * The surface, replaced whole. `moves` names the apps that were renamed, old name to
   * new, so what the store holds about them follows; everything held about an app no
   * longer in the list goes with it. Any app left pending is compiled.
   */
  replace(apps: App[], moves?: Map<string, string>): void {
    for (const [from, to] of moves ?? []) {
      // A compile still streaming under the old name would land on an app that is no
      // longer there, so it is given up and the renamed app starts over.
      if (this.#progress.get(from)?.running) {
        this.#controllers.get(from)?.abort();
        this.#controllers.delete(from);
        this.#progress.delete(from);
        this.#startedAt.delete(from);
        apps = apps.map((app) => (app.configuration.name === to ? { ...app, compilation: { status: "pending", warnings: 0 } } : app));
      }
      for (const held of [this.#progress, this.#manifests, this.#startedAt] as Map<string, unknown>[]) {
        const value = held.get(from);
        held.delete(from);
        if (value !== undefined) held.set(to, value);
      }
    }
    const names = new Set(apps.map((app) => app.configuration.name));
    for (const name of [...this.#controllers.keys()]) {
      if (names.has(name)) continue;
      this.#controllers.get(name)?.abort();
      this.#controllers.delete(name);
    }
    for (const held of [this.#progress, this.#manifests, this.#startedAt]) {
      for (const name of [...held.keys()]) if (!names.has(name)) held.delete(name);
    }
    this.#apps = apps;
    for (const listener of this.#surfaceListeners) listener();
    this.#compilePending();
  }

  update(change: (apps: App[]) => App[]): void {
    const next = change(this.#apps);
    if (next !== this.#apps) this.replace(next);
  }

  /**
   * The workspace's apps as a window opens on them: one whose stored manifest still
   * describes it is built from that manifest and reads as ready while the server
   * reopens it; any other starts pending.
   */
  open(configurations: WorkspaceApp[], stored: Map<string, StoredManifest>): void {
    const manifests = new Map<string, string>();
    const apps = configurations.map((configuration) => {
      const held = stored.get(configuration.name);
      if (!matchesStored(configuration, held)) return createPendingApp(configuration);
      try {
        const app = loadApp(parseManifest(held.manifest), configuration);
        manifests.set(configuration.name, held.manifest);
        return { ...app, compilation: { status: "cached" as const, warnings: 0 } };
      } catch (error) {
        console.error(`Failed to load the stored ${configuration.name}`, error);
        return createPendingApp(configuration);
      }
    });
    for (const [name, manifest] of manifests) this.#manifests.set(name, manifest);
    this.replace(apps);
  }

  // The Recompile gesture: the one caller that asks the server to compile again where
  // it has this app already. An app already compiling is left to finish.
  recompile(name?: string): void {
    for (const app of this.#apps) {
      if (name !== undefined && app.configuration.name !== name) continue;
      if (app.compilation.status === "pending" || app.compilation.status === "running") continue;
      void this.compile(app.configuration.name, true);
    }
  }

  async compile(name: string, fresh = false): Promise<void> {
    const app = this.app(name);
    if (!app) return;
    if (this.#progress.get(name)?.running) {
      // Pending under a running compile is a configuration that moved since that compile
      // started, so it is started over; anything else is left to finish.
      if (app.compilation.status !== "pending") return;
      this.#controllers.get(name)?.abort();
    }
    const controller = new AbortController();
    const signal = controller.signal;
    this.#controllers.set(name, controller);
    this.#startedAt.set(name, Date.now());
    this.#setProgress(name, { running: true, logs: [] });
    if (app.compilation.status !== "cached" || fresh) {
      this.#setApp(name, (current) => ({ ...current, compilation: { ...current.compilation, status: "running" } }));
    }

    try {
      for await (const response of this.compiler({ app: app.configuration, fresh }, signal)) {
        if (signal.aborted) return;
        this.#appendLogs(name, response.logs);
        if (response.status === CompileStatus.STATUS_RUNNING) continue;
        this.#land(name, response);
        return;
      }
      if (!signal.aborted) this.#fail(name, "Compilation ended without a verdict");
    } catch (error: any) {
      if (signal.aborted) return;
      // Stated on the app's row in the compile status and in its log, two glyphs from
      // the footer's error count; through `deviceConsole` so one failure doesn't light
      // both.
      deviceConsole.error("Compilation error:", error);
      this.#fail(name, `Compilation failed: ${error?.message ?? error}`);
    } finally {
      if (this.#controllers.get(name) === controller) {
        this.#controllers.delete(name);
        this.#setProgress(name, { running: false, logs: this.progressOf(name).logs });
      }
    }
  }

  #land(name: string, response: CompileResponse): void {
    const current = this.app(name);
    if (!current) return;
    const logs = this.progressOf(name).logs;
    const duration = this.#elapsed(name);
    if (response.status !== CompileStatus.STATUS_READY) {
      this.#setApp(name, (app) => ({ ...app, compilation: { status: "error", duration, warnings: 0, error: firstErrorLine(logs) } }));
      return;
    }
    const compilation = { status: "success" as const, duration, warnings: countWarnings(logs) };
    if (this.#manifests.get(name) === response.manifest && isReady(current.compilation.status)) {
      // The surface the window already holds, so nothing re-reads the models.
      this.#setApp(name, (app) => ({ ...app, compilation }));
      return;
    }
    let loaded: App;
    try {
      loaded = loadApp(parseManifest(response.manifest), current.configuration);
    } catch (error) {
      console.error(`Failed to load the compiled ${name}`, error);
      this.#fail(name, `Failed to load the compiled app: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.#manifests.set(name, response.manifest);
    this.#setApp(name, () => ({ ...loaded, compilation }));
    storeManifest(current.configuration, response.manifest);
  }

  #fail(name: string, message: string): void {
    this.#appendLogs(name, [{ level: LogLevel.LEVEL_ERROR, message }]);
    const logs = this.progressOf(name).logs;
    this.#setApp(name, (app) => ({ ...app, compilation: { status: "error", duration: this.#elapsed(name), warnings: 0, error: firstErrorLine(logs) } }));
  }

  #elapsed(name: string): string {
    return formatDuration(Date.now() - (this.#startedAt.get(name) ?? Date.now()));
  }

  // One app replaced in place. The list is what React reads, so it is a new array.
  #setApp(name: string, change: (app: App) => App): void {
    const index = this.#apps.findIndex((app) => app.configuration.name === name);
    if (index === -1) return;
    const next = [...this.#apps];
    next[index] = change(this.#apps[index]);
    this.#apps = next;
    for (const listener of this.#surfaceListeners) listener();
  }

  #setProgress(name: string, progress: CompileProgress): void {
    this.#progress.set(name, progress);
    this.#progressVersion++;
    for (const listener of this.#progressListeners) listener();
  }

  #appendLogs(name: string, logs: Log[]): void {
    if (logs.length === 0) return;
    const held = this.progressOf(name);
    this.#setProgress(name, { running: held.running, logs: [...held.logs, ...logs] });
  }

  // Every app waiting on a compile, each on its own stream. Scheduled rather than run
  // at once, so a list replaced twice in one tick compiles each app once.
  #compilePending(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      for (const app of this.#apps) {
        const status = app.compilation.status;
        if (status === "pending" || (status === "cached" && !this.#progress.has(app.configuration.name))) void this.compile(app.configuration.name);
      }
    });
  }
}

export const appStore = new AppStore();
