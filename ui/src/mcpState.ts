/**
 * What Kaja's own MCP server is doing, in the five states the plug and the page both
 * draw. It is one derivation because the two are read together: the mark in the
 * sidebar band says whether the server is on, and the page says the same thing in
 * words a line further down.
 *
 * The two marks never say the same thing. The **dot** answers "is it on"; the
 * **glow** answers "is anyone on it" — so when the glow is up the dot goes away
 * rather than repeating it.
 */

export type McpState = "off" | "starting" | "error" | "running" | "active";

// McpConnection is a live MCP endpoint and the token that reaches it, whichever build
// produced it. MCPInfo satisfies it, which is why it is a shape rather than that type.
export interface McpConnection {
  enabled: boolean;
  url: string;
  token: string;
  error: string;
  configurationPaths?: Record<string, string | undefined>;
}

// McpControl is the switch, the window attachment it controls, and the one other verb
// that changes the server rather than reading it.
export interface McpControl {
  enabled: boolean;
  attached: boolean;
  onDuty: boolean;
  error?: string;
  setEnabled: (enabled: boolean) => void;
  regenerateToken: () => void;
}

export interface McpConditions {
  /** The switch. */
  enabled: boolean;
  /** There is an endpoint answering under a token. */
  listening: boolean;
  /** This window's stream is open. */
  attached: boolean;
  /** A run would land in this window rather than another one of yours. */
  onDuty: boolean;
  /** An agent is calling right now. */
  active: boolean;
  error?: string;
}

export interface McpStatus {
  state: McpState;
  /** The one word the band leads with. */
  headline: string;
  /** The sentence beside it, absent where the headline is the whole answer. */
  note?: string;
  tone: "muted" | "destructive" | "emerald";
}

/** What the sidebar's plug and the page's headline are both read off. */
export function mcpStatusOf(info: McpConnection | undefined, control: McpControl, active: boolean): McpStatus {
  return mcpStatus({
    enabled: control.enabled,
    listening: isListening(info),
    attached: control.attached,
    onDuty: control.onDuty,
    active,
    error: info?.error || control.error,
  });
}

/** An endpoint answering under a token is the whole of what listening means. */
export function isListening(info: McpConnection | undefined): boolean {
  return !!info?.enabled && !!info.url && !!info.token;
}

export function mcpStatus({ enabled, listening, attached, onDuty, active, error }: McpConditions): McpStatus {
  if (error) return { state: "error", headline: "Failed to start", note: error, tone: "destructive" };
  if (!enabled) return { state: "off", headline: "Off", note: "turn it on to let an agent connect", tone: "muted" };
  // Two different waits, and saying so is what keeps one of them from reading as the
  // other: an endpoint that isn't up yet is the server starting, while an endpoint
  // already named with no stream on it is this window reaching it.
  if (!listening) return { state: "starting", headline: "Starting", note: "opening the endpoint", tone: "muted" };
  if (!attached) return { state: "starting", headline: "Starting", note: "connecting this window", tone: "muted" };
  // Being on duty is what a window is unless it says otherwise, and a run's console is
  // held in the window that ran it — so the only thing worth a line is not being it.
  // Whether an agent is out there is not something to say either way: the endpoint is
  // answered a request at a time, so nothing here knows who has been pointed at it or
  // when they last called, and an idle minute is not an agent that never arrived.
  if (active) return { state: "active", headline: "Running", tone: "emerald" };
  return { state: "running", headline: "Running", note: onDuty ? undefined : "another window of yours is on duty", tone: "muted" };
}

/** The dot at the plug's corner and in front of the page's headline. */
export function mcpDotClass(state: McpState): string | undefined {
  switch (state) {
    case "off":
      return "bg-muted-foreground";
    case "starting":
      return "bg-amber-500";
    case "error":
      return "bg-destructive";
    case "running":
      return "bg-emerald-500";
    // The glow is already saying it.
    case "active":
      return undefined;
  }
}

/** What the plug itself wears: colour, and the ring only a call in flight lights. */
export function mcpPlugClass(state: McpState): string | undefined {
  switch (state) {
    case "error":
      return "text-destructive";
    case "active":
      return "text-emerald-600 dark:text-emerald-400";
    default:
      return undefined;
  }
}
