/**
 * The agent session: the window's end of the switchboard an agent reaches Kaja through,
 * on both builds.
 *
 * Nothing behind it can run a script — the `kaja` object and the service clients are
 * JavaScript in here — so `run_script` is forwarded to a window that has offered itself
 * and its answer forwarded back. This module is that offer, and everything else that
 * cannot be answered without a window: what is callable, which window is being looked
 * at, and what an agent did to a file on disk.
 *
 * On the **web** the token is the address of this browser, not a key to the server: it
 * is made up here, never anywhere but this browser's storage, and opens nothing while
 * no window is listening. Until the server switch is turned on there is no stream or
 * session. Being an address rather than a session, it is minted once and **outlives
 * the switch**: turning the server off closes the session under it and leaves every
 * configuration already pasted naming the same browser, which is why rolling it costs
 * the deliberate gesture Regenerate token is. Both it and the switch are this
 * browser's settings (`settings.ts`), which every tab shares and hears change, so
 * connecting in one window attaches the others as they are.
 *
 * On the **desktop** the process persists the token so installed agents keep working,
 * and hands it over (`adopt`) while its server is on. That is the whole of the
 * difference: one window attached on the mux the webview already fetches its calls on.
 */

import { linkRoot } from "./scriptLink";
import { getSettings, saveMcpToken, subscribeSettings } from "./settings";
import { isWailsEnvironment } from "./wails";

// How long the sidebar's plug stays lit after the last request is answered. An agent's
// calls arrive in bursts of a few milliseconds.
const ACTIVITY_LINGER_MS = 2500;
// A dropped stream is ordinary — a laptop sleeps, a proxy restarts — so it is
// reconnected without saying anything, backing off to this.
const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 15000;
// The server pings the stream every twenty seconds. A stream that has carried nothing
// for this long is one a proxy let go of without saying so, and is opened again.
const STREAM_IDLE_MS = 45000;
// The catalog follows every change to the apps, and a compile lands several in a row.
const CATALOG_DEBOUNCE_MS = 250;
// How often a run says what it has done so far, where the agent asked to hear it. It is
// a beat rather than a report per call: a perf test makes thousands, and what the agent
// is reading is that the wait is a run rather than a stall.
const PROGRESS_MS = 2000;

export interface AgentSessionState {
  /** Whether this build can open an MCP server. */
  available: boolean;
  /** Whether the switch is on, so an agent can reach this browser. Shared by every tab. */
  connected: boolean;
  /** Whether this window's stream is open. */
  attached: boolean;
  /** Whether a run would land in this window rather than another one of yours. */
  onDuty: boolean;
  /** The endpoint an agent is pointed at, and the token that names this browser. Both outlive the switch. */
  url?: string;
  token?: string;
  error?: string;
}

/**
 * What a run asks of the window. Code is always set; path is what it lands under, and
 * client is what the agent calls itself.
 *
 * The field is `client` because that is the MCP handshake's own word for the end that
 * connects, and this carries its `clientInfo` name verbatim. Everywhere the product
 * says it rather than the protocol — the page, the sidebar row, the stored draft — the
 * word is **agent**.
 */
export interface AgentRun {
  path: string;
  code: string;
  client?: string;
  /**
   * Aborted when the agent gives up on the run — it timed out, or the request went
   * away. Nobody is coming for what the run produces after that, and a script left
   * going holds everything it opened, so giving up on the answer ends the run.
   */
  controller: AbortController;
  /**
   * Set where the agent asked to hear about the run before it is over. The run hands
   * over a way to read how many calls it has made so far and the beat is the session's,
   * because what is being reported is that the wait is a run rather than a stall. How
   * long the agent has waited is measured where it is waiting.
   */
  progress?: (calls: () => number) => void;
}

/** What an agent did to a file on disk, so the sidebar and an open editor keep up. */
export interface AgentScriptChange {
  action: "write" | "create" | "rename" | "delete";
  path: string;
  oldPath?: string;
  name?: string;
  folder?: string;
  content?: string;
}

interface Message {
  type: string;
  streamId?: string;
  runId?: string;
  path?: string;
  code?: string;
  client?: string;
  inFlight?: number;
  onDuty?: boolean;
  change?: AgentScriptChange;
  progress?: boolean;
}

// What an earlier build or a hand edit left behind is not an address the server accepts.
function storedToken(): string | undefined {
  const token = getSettings().mcp.token;
  return typeof token === "string" && token.length >= 24 ? token : undefined;
}

// A token is 32 hex characters of the browser's own randomness, which is what the
// server checks the shape of and nothing more: the server never issues one.
function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

class AgentSession {
  private state: AgentSessionState = { available: false, connected: false, attached: false, onDuty: false };
  private listeners = new Set<() => void>();
  private runner?: (run: AgentRun) => Promise<unknown>;
  private onActivity?: (active: boolean) => void;
  private onScripts?: (change: AgentScriptChange) => void;
  // Built when it is pushed rather than when it changes, so a burst of changes is one
  // serialization and the newest one.
  private catalog?: () => string;
  private catalogTimer?: number;
  private catalogInFlight = false;
  private catalogStale = false;
  // The desktop's token, handed over by the process that persists it. Where there is
  // one it is the session, and this browser's own storage is not consulted.
  private hostToken?: string;
  private streamId?: string;
  private abort?: AbortController;
  // The token this window's stream is open under, which is what tells a stream that is
  // still the right one from a stream on an address that has since been rolled.
  private held?: string;
  // Set while a reconnection is waiting out its backoff, so coming back can cut it short.
  private wake?: () => void;
  private activityTimer?: number;
  private started = false;
  private reconnect = RECONNECT_MS;
  // The runs this window is carrying for an agent, so one the agent gave up on can be
  // ended rather than left going with nothing waiting for it.
  private running = new Map<string, AbortController>();

  getState = (): AgentSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Wires the session to the window and, if this browser is already connected,
   * attaches. Safe to call more than once.
   */
  start(runner: (run: AgentRun) => Promise<unknown>, onActivity: (active: boolean) => void, onScripts: (change: AgentScriptChange) => void): void {
    this.runner = runner;
    this.onActivity = onActivity;
    this.onScripts = onScripts;
    if (this.started) return;
    this.started = true;

    window.addEventListener("focus", this.reportFocus);
    document.addEventListener("visibilitychange", this.reportFocus);
    window.addEventListener("online", this.retryNow);
    // The desktop waits for the switch to start its server and hand over the token.
    if (isWailsEnvironment()) return;

    void this.readAvailability();
    subscribeSettings(this.onSettings);
    // The address is this browser's whether or not the switch is on, so it is minted
    // here rather than by turning the server on: the page names an endpoint and a
    // token from the first time it is opened, and nothing about them changes when the
    // switch does.
    if (!storedToken()) saveMcpToken(newToken());
    this.update(this.address());
    // Nothing is attached here: the switch is the person's laid over the workspace's,
    // and setSwitch is what acts on it.
  }

  /**
   * Attaches with the token the host process issued rather than one this browser made
   * up. Nothing else about the session differs, which is what makes the desktop the
   * degenerate case of it: one window attached while the loopback server is on.
   */
  adopt(token: string): void {
    if (this.hostToken === token) return;
    this.hostToken = token;
    this.update({ available: true });
    this.attach();
  }

  /**
   * The switch, applied: this browser's setting, or the workspace's where it has never
   * been flipped. Off tells the server rather than leaving the session to time out:
   * until it forgets the token, discovery would go on answering under it. The token
   * stays either way, because it is where this browser is reached and not whether
   * anything answers there.
   */
  setSwitch(enabled: boolean): void {
    if (isWailsEnvironment()) return;
    if (enabled) {
      this.attach();
      return;
    }
    // Nothing to turn off, which is every load of a browser that has it off.
    if (!this.state.connected) return;
    const token = storedToken();
    this.detach();
    if (token) {
      void fetch("/agent-session/detach", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  }

  /**
   * Rolls the token this browser is reached at, leaving the switch where it is. Every
   * config already pasted names the old one, which is the whole point — so the old
   * session is dropped rather than left to time out. This is the only thing that
   * changes the address, which is why the page asks twice for it.
   */
  regenerateToken(): void {
    const previous = storedToken();
    const wasOn = this.state.connected;
    this.detach();
    if (previous) {
      void fetch("/agent-session/detach", { method: "POST", headers: { Authorization: `Bearer ${previous}` } }).catch(() => {});
    }
    saveMcpToken(newToken());
    this.update(this.address());
    if (wasOn) this.attach();
  }

  /** Detaches the desktop window when its loopback server is turned off. */
  releaseHost(): void {
    this.hostToken = undefined;
    this.detach();
  }

  /**
   * Hands the server what this window says is callable. Debounced, and pushed again
   * on attach and on taking duty, since the server takes a catalog from the window on
   * duty alone.
   */
  setCatalog(catalog: () => string): void {
    this.catalog = catalog;
    window.clearTimeout(this.catalogTimer);
    this.catalogTimer = window.setTimeout(() => void this.pushCatalog(), CATALOG_DEBOUNCE_MS);
  }

  // One push in flight at a time; a catalog that changed meanwhile goes out after it.
  private async pushCatalog(): Promise<void> {
    if (!this.catalog || !this.state.onDuty) return;
    if (this.catalogInFlight) {
      this.catalogStale = true;
      return;
    }
    this.catalogInFlight = true;
    try {
      do {
        this.catalogStale = false;
        await this.post("/agent-session/catalog", this.catalog(), true, { "X-Kaja-Stream": this.streamId ?? "" });
      } while (this.catalogStale);
    } finally {
      this.catalogInFlight = false;
    }
  }

  /**
   * Tells the agent waiting on a New app form it opened what the person did with it.
   * Sent whether or not this window's stream is up, like a run's result: the form was
   * finished once, and there is nothing to finish again.
   */
  reportAppForm(request: string, outcome: { saved: boolean; name?: string }): void {
    void this.post("/agent-session/app-form", JSON.stringify({ request, ...outcome }), false);
  }

  // A token rolled in another tab is a new address, and the stream this window holds is
  // on the old one.
  private onSettings = () => {
    if (isWailsEnvironment()) return;
    this.update(this.address());
    if (this.state.connected) this.attach();
  };

  private async readAvailability(): Promise<void> {
    try {
      const response = await fetch("/agent-session", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const body = (await response.json()) as { available?: boolean };
      this.update({ available: body.available === true });
    } catch {
      // A server that doesn't answer doesn't offer it: the footer simply has no plug.
    }
  }

  // The token this window attaches under: the desktop's, else this browser's own.
  private currentToken(): string | undefined {
    return this.hostToken ?? storedToken();
  }

  // Where this browser is reached, which is not a thing the switch decides. The
  // desktop's endpoint is the loopback listener the process reports, not this page.
  private address(): Pick<AgentSessionState, "token" | "url"> {
    const token = this.currentToken();
    return { token, url: token && !this.hostToken ? `${window.location.origin}/mcp` : undefined };
  }

  private attach(): void {
    const token = this.currentToken();
    // A token rolled in another tab is a different address, and the stream this window
    // holds is on the old one.
    if (this.abort && this.held !== token) this.detach();
    if (!token) {
      this.update({ connected: false, ...this.address() });
      return;
    }
    if (this.abort) {
      this.update({ connected: true });
      return;
    }
    this.held = token;
    this.update({ connected: true, ...this.address() });
    this.abort = new AbortController();
    void this.hold(token, this.abort);
  }

  private detach(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.held = undefined;
    this.streamId = undefined;
    this.wake?.();
    this.update({ connected: false, attached: false, onDuty: false, error: undefined, ...this.address() });
  }

  // hold keeps the stream open for as long as this browser is connected, reopening it
  // when it drops. The server holds nothing at rest, so a reconnection is an ordinary
  // attach — the catalog is pushed again with it.
  private async hold(token: string, abort: AbortController): Promise<void> {
    while (!abort.signal.aborted) {
      try {
        const response = await fetch("/agent-session/attach", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`the server refused the session (${response.status})`);
        }
        this.reconnect = RECONNECT_MS;
        this.update({ attached: true, error: undefined });
        await this.read(response.body);
      } catch (err) {
        if (abort.signal.aborted) return;
        this.update({ error: err instanceof Error ? err.message : String(err) });
      }
      if (abort.signal.aborted) return;
      this.update({ attached: false, onDuty: false });
      this.streamId = undefined;
      // Jittered, so every window that lost one server does not come back on one beat.
      await this.sleep(this.reconnect * (0.5 + Math.random()));
      this.reconnect = Math.min(this.reconnect * 2, RECONNECT_MAX_MS);
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await this.readWithin(reader, STREAM_IDLE_MS);
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            this.handle(JSON.parse(line) as Message);
          } catch {
            // A line that isn't a message is a line from something that isn't this server.
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
  }

  // A read that outlasts the server's own pings is a stream nothing is on the other
  // end of, cancelled so the loop above opens another.
  private readWithin(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ms: number,
  ): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        void reader.cancel().catch(() => {});
        reject(new Error("the session stream went quiet"));
      }, ms);
      reader.read().then(
        (result) => {
          window.clearTimeout(timer);
          resolve(result);
        },
        (err) => {
          window.clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private handle(message: Message): void {
    switch (message.type) {
      case "hello":
        this.streamId = message.streamId;
        this.reportFocus();
        break;
      case "duty": {
        const onDuty = message.onDuty === true;
        const taking = onDuty && !this.state.onDuty;
        this.update({ onDuty });
        if (taking) void this.pushCatalog();
        break;
      }
      case "activity":
        this.markActive((message.inFlight ?? 0) > 0);
        break;
      case "run":
        void this.run(message);
        break;
      case "abort":
        if (message.runId) this.running.get(message.runId)?.abort();
        break;
      case "scripts":
        if (message.change) this.onScripts?.(message.change);
        break;
    }
  }

  private async run(message: Message): Promise<void> {
    if (!message.runId) return;
    const runId = message.runId;
    const controller = new AbortController();
    this.running.set(runId, controller);
    let beat: number | undefined;
    const progress = message.progress
      ? (calls: () => number) => {
          beat = window.setInterval(() => void this.post("/agent-session/progress", JSON.stringify({ runId, progress: { calls: calls() } })), PROGRESS_MS);
        }
      : undefined;
    let result: unknown;
    try {
      result = await this.runner?.({ path: message.path ?? "", code: message.code ?? "", client: message.client, controller, progress });
    } catch (err) {
      result = { console: [], error: err instanceof Error ? err.message : String(err), methodCalls: [] };
    } finally {
      window.clearInterval(beat);
      this.running.delete(runId);
    }
    // A run's answer goes out even where the stream this window is holding has
    // dropped: the stream is reopened without anything being said, but the run
    // happened once and there is nothing to run again to get its result back.
    await this.post("/agent-session/result", JSON.stringify({ runId, result }), false);
  }

  // markActive lights the plug and holds it a beat past the last request, which makes
  // a burst of calls one visible event rather than none.
  private markActive(inFlight: boolean): void {
    window.clearTimeout(this.activityTimer);
    this.onActivity?.(true);
    if (!inFlight) {
      this.activityTimer = window.setTimeout(() => this.onActivity?.(false), ACTIVITY_LINGER_MS);
    }
  }

  // reportFocus decides where a run lands. A run's console is held in the window that
  // ran it, so it has to be the window being looked at.
  private reportFocus = (): void => {
    if (document.visibilityState === "hidden") return;
    // Coming back to a window whose stream dropped while it was away is the moment to
    // stop waiting: sitting out fifteen seconds of backoff is the whole of what makes
    // the page look stuck on a server that is answering.
    if (!this.state.attached) this.retryNow();
    if (!this.streamId) return;
    // Where a link to this window starts rides along, because a form an agent opens is
    // sent where a run is: to the window being looked at.
    void this.post("/agent-session/focus", JSON.stringify({ streamId: this.streamId, linkRoot: linkRoot() }));
  };

  // A reconnection that is waiting is one that can be asked for now.
  private retryNow = (): void => {
    this.reconnect = RECONNECT_MS;
    this.wake?.();
  };

  // Waits, but no longer than something asking for the reconnection now.
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer = 0;
      const done = () => {
        window.clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      timer = window.setTimeout(done, ms);
      this.wake = done;
    });
  }

  /**
   * `whileAttached` is what the message is worth when this window's stream is down.
   * The catalog and the focus are re-sent by an attach, so sending them into a
   * dropped stream is work for nothing; a run's result is not — it is the answer to
   * something that already happened.
   */
  private async post(path: string, body: string, whileAttached = true, headers: Record<string, string> = {}): Promise<void> {
    const token = this.currentToken();
    if (!token || (whileAttached && !this.state.attached)) return;
    try {
      await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
        body,
      });
    } catch {
      // The stream notices the same failure and reconnects.
    }
  }

  private update(patch: Partial<AgentSessionState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof AgentSessionState)[]).every((key) => this.state[key] === next[key])) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const agentSession = new AgentSession();
