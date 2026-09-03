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
 * the deliberate gesture Regenerate token is. It is the one thing kept in
 * `localStorage` rather than in `storage.ts`,
 * because localStorage is shared between an origin's tabs *and* says when it changes —
 * so connecting in one window attaches the others as they are. The IndexedDB store
 * reads itself once at startup, which would make a second window find out on its next
 * reload.
 *
 * On the **desktop** the process persists the token so installed agents keep working,
 * and hands it over (`adopt`) while its server is on. That is the whole of the
 * difference: one window attached on the mux the webview already fetches its calls on.
 */

import { isWailsEnvironment } from "./wails";

const STORAGE_KEY = "kaja:agentSession";
// How long the sidebar's plug stays lit after the last request is answered. An agent's
// calls arrive in bursts of a few milliseconds.
const ACTIVITY_LINGER_MS = 2500;
// A dropped stream is ordinary — a laptop sleeps, a proxy restarts — so it is
// reconnected without saying anything, backing off to this.
const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 15000;

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
}

interface Stored {
  token: string;
  /** The switch. Absent in what the first shape of this key wrote, which was only ever written while on. */
  connected?: boolean;
}

function readStored(): Stored | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Stored;
    return typeof parsed?.token === "string" && parsed.token.length >= 24 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(stored: Stored): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A browser refusing storage is one the token cannot outlive a reload in; the
    // session still works for as long as this window is open.
  }
}

/** Whether the switch is on. A stored token from before there was a flag means on. */
function isOn(stored: Stored | undefined): boolean {
  return !!stored && stored.connected !== false;
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
  private catalog?: string;
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
    window.addEventListener("storage", this.onStorage);
    // The address is this browser's whether or not the switch is on, so it is minted
    // here rather than by turning the server on: the page names an endpoint and a
    // token from the first time it is opened, and nothing about them changes when the
    // switch does.
    let stored = readStored();
    if (!stored) {
      stored = { token: newToken(), connected: false };
      writeStored(stored);
    }
    this.update(this.address());
    if (isOn(stored)) this.attach();
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

  /** Turns the web server on, on this browser's own address, with a stream in every window. */
  connect(): void {
    writeStored({ token: readStored()?.token ?? newToken(), connected: true });
    this.attach();
  }

  /**
   * Turns the web server off. The token stays: it is where this browser is reached, not
   * the session, so every configuration already pasted is still pointed here and turning
   * the switch back on needs nothing pasted again. The server is told rather than left to
   * time the session out — until it forgets the token, discovery would go on answering
   * under it.
   */
  disconnect(): void {
    const token = readStored()?.token;
    if (token) writeStored({ token, connected: false });
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
    const previous = readStored();
    this.detach();
    if (previous?.token) {
      void fetch("/agent-session/detach", { method: "POST", headers: { Authorization: `Bearer ${previous.token}` } }).catch(() => {});
    }
    writeStored({ token: newToken(), connected: isOn(previous) });
    this.update(this.address());
    if (isOn(previous)) this.attach();
  }

  /** Detaches the desktop window when its loopback server is turned off. */
  releaseHost(): void {
    this.hostToken = undefined;
    this.detach();
  }

  /** Hands the server what this window says is callable. */
  setCatalog(catalog: string): void {
    this.catalog = catalog;
    void this.post("/agent-session/catalog", catalog);
  }

  private onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    if (isOn(readStored())) {
      this.attach();
    } else {
      this.detach();
    }
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
    return this.hostToken ?? readStored()?.token;
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
        if (this.catalog) void this.post("/agent-session/catalog", this.catalog);
        await this.read(response.body);
      } catch (err) {
        if (abort.signal.aborted) return;
        this.update({ error: err instanceof Error ? err.message : String(err) });
      }
      if (abort.signal.aborted) return;
      this.update({ attached: false, onDuty: false });
      this.streamId = undefined;
      await this.sleep(this.reconnect);
      this.reconnect = Math.min(this.reconnect * 2, RECONNECT_MAX_MS);
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
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

  private handle(message: Message): void {
    switch (message.type) {
      case "hello":
        this.streamId = message.streamId;
        this.reportFocus();
        break;
      case "duty":
        this.update({ onDuty: message.onDuty === true });
        break;
      case "activity":
        this.markActive((message.inFlight ?? 0) > 0);
        break;
      case "run":
        void this.run(message);
        break;
      case "scripts":
        if (message.change) this.onScripts?.(message.change);
        break;
    }
  }

  private async run(message: Message): Promise<void> {
    if (!message.runId) return;
    const runId = message.runId;
    let result: unknown;
    try {
      result = await this.runner?.({ path: message.path ?? "", code: message.code ?? "", client: message.client });
    } catch (err) {
      result = { console: [], error: err instanceof Error ? err.message : String(err), methodCalls: [] };
    }
    await this.post("/agent-session/result", JSON.stringify({ runId, result }));
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
    void this.post("/agent-session/focus", JSON.stringify({ streamId: this.streamId }));
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

  private async post(path: string, body: string): Promise<void> {
    const token = this.currentToken();
    if (!token || !this.state.attached) return;
    try {
      await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
