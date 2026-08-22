/**
 * The agent session: how a Kaja served over the web answers an agent.
 *
 * The desktop app needs none of this, because the process is the window. A
 * server has no window at all — a script runs in the browser, where the `kaja`
 * object and the service clients live — so it can only answer `run_script` by
 * forwarding it to a window that has offered itself. This module is that offer:
 * the tab makes up a token, holds a stream open under it, and runs what comes
 * down it.
 *
 * **The token is the address of this browser, not a key to the server.** It is
 * made up here, it is never anywhere but this browser's storage, and it opens
 * nothing while no window is listening — so an agent that has it can only reach
 * a window you have open. Connecting is deliberate and per browser: until it is
 * pressed there is no token, no stream and no session.
 *
 * It is the one thing kept in `localStorage` rather than in `storage.ts`, and
 * for the reason the whole design rests on: localStorage is shared between the
 * tabs of an origin *and* says when it changes, so connecting in one window
 * attaches the others as they are, and disconnecting detaches them. The
 * IndexedDB store reads itself once at startup, which would make a second window
 * find out on its next reload.
 */

import { isWailsEnvironment } from "./wails";

const STORAGE_KEY = "kaja:agentSession";
// How long the footer's plug stays lit after the last request is answered. An
// agent's calls arrive in bursts of a few milliseconds; a mark that came and
// went inside one frame would say nothing.
const ACTIVITY_LINGER_MS = 2500;
// A dropped stream is ordinary — a laptop sleeps, a proxy restarts — so it is
// reconnected without saying anything, backing off to this.
const RECONNECT_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export interface AgentSessionState {
  /** Whether this server opens the door at all. False on the desktop, which has its own. */
  available: boolean;
  /** Whether this browser has connected an agent. Shared by every tab. */
  connected: boolean;
  /** Whether this window's stream is open. */
  attached: boolean;
  /** Whether a run would land in this window rather than another one of yours. */
  onDuty: boolean;
  /** The endpoint an agent is pointed at, and the token that names this browser. */
  url?: string;
  token?: string;
  error?: string;
}

/**
 * What a run asks of the window. Code is always set; path is what it lands
 * under, and client is what the agent calls itself — the name the draft an
 * inline snippet runs in is labelled with.
 */
export interface AgentRun {
  path: string;
  code: string;
  client?: string;
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
}

interface Stored {
  token: string;
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

// A token is 32 hex characters of the browser's own randomness, which is what
// the server checks the shape of and nothing more: the server never issues one,
// so there is nothing for it to remember.
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
  private catalog?: string;
  private streamId?: string;
  private abort?: AbortController;
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
  start(runner: (run: AgentRun) => Promise<unknown>, onActivity: (active: boolean) => void): void {
    this.runner = runner;
    this.onActivity = onActivity;
    if (this.started || isWailsEnvironment()) return;
    this.started = true;

    void this.readAvailability();
    window.addEventListener("storage", this.onStorage);
    window.addEventListener("focus", this.reportFocus);
    document.addEventListener("visibilitychange", this.reportFocus);
    if (readStored()) this.attach();
  }

  /** Connects this browser: a token, and a stream in every window that has one. */
  connect(): void {
    const token = readStored()?.token ?? newToken();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token } satisfies Stored));
    this.attach();
  }

  /**
   * Disconnects and rolls the token, which is the answer to having pasted it
   * somewhere it should not have gone. The server is told rather than left to
   * time the session out: until it forgets the token, discovery would go on
   * answering under it.
   */
  disconnect(): void {
    const token = readStored()?.token;
    window.localStorage.removeItem(STORAGE_KEY);
    this.detach();
    if (token) {
      void fetch("/agent-session/detach", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
  }

  /** Hands the server what this window says is callable. */
  setCatalog(catalog: string): void {
    this.catalog = catalog;
    void this.post("/agent-session/catalog", catalog);
  }

  private onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    if (readStored()) {
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
      // A server that doesn't answer doesn't offer it. Nothing to report: the
      // footer simply has no plug.
    }
  }

  private attach(): void {
    const stored = readStored();
    if (!stored || this.abort) {
      this.update({ connected: !!stored });
      return;
    }
    this.update({ connected: true, token: stored.token, url: `${window.location.origin}/mcp` });
    this.abort = new AbortController();
    void this.hold(stored.token, this.abort);
  }

  private detach(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.streamId = undefined;
    this.update({ connected: false, attached: false, onDuty: false, token: undefined, url: undefined, error: undefined });
  }

  // hold keeps the stream open for as long as this browser is connected,
  // reopening it when it drops. The server holds nothing at rest, so a
  // reconnection is an ordinary attach — the catalog is pushed again with it.
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
      await new Promise((resolve) => window.setTimeout(resolve, this.reconnect));
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
            // A line that isn't a message is a line from something that isn't
            // this server. Nothing to do with it.
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

  // markActive lights the plug and holds it a beat past the last request, which
  // is what makes a burst of calls one visible event rather than none.
  private markActive(inFlight: boolean): void {
    window.clearTimeout(this.activityTimer);
    this.onActivity?.(true);
    if (!inFlight) {
      this.activityTimer = window.setTimeout(() => this.onActivity?.(false), ACTIVITY_LINGER_MS);
    }
  }

  // reportFocus is what decides where a run lands. The console of a run is held
  // in the window that ran it, so it has to be the window being looked at.
  private reportFocus = (): void => {
    if (!this.streamId || document.visibilityState === "hidden") return;
    void this.post("/agent-session/focus", JSON.stringify({ streamId: this.streamId }));
  };

  private async post(path: string, body: string): Promise<void> {
    const token = readStored()?.token;
    if (!token || !this.state.attached) return;
    try {
      await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      });
    } catch {
      // The stream notices the same failure and reconnects; nothing here is
      // worth a second report of it.
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
