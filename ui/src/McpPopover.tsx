import { useEffect, useRef, useState } from "react";

import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Button } from "./components/button";
import { elideToken, mcpClients, type McpEndpoint } from "./mcpClients";
import { desktop, isWailsEnvironment, openInBrowser } from "./wails";

// McpConnection is a live MCP endpoint and the token that reaches it, whichever build
// produced it. MCPInfo satisfies it, which is why it is a shape rather than that type.
export interface McpConnection {
  enabled: boolean;
  url: string;
  token: string;
  error: string;
  configurationPaths?: Record<string, string | undefined>;
}

// AgentFooter is the web's half: a session is something this window offers, so the
// footer is where it is offered, taken back, and reported on.
export interface AgentFooter {
  connected: boolean;
  attached: boolean;
  onDuty: boolean;
  error?: string;
  connect: () => void;
  disconnect: () => void;
}

// A copy verb is its own receipt: the label swaps in place for this long, and nothing
// else about the popover moves.
const COPIED_MS = 1500;

// With nothing listening there is no endpoint to name, so the snippets are written
// against the address this build would answer on — dimmed, uncopyable, and there to be
// read rather than pasted.
function idleUrl(): string {
  return isWailsEnvironment() ? "http://127.0.0.1:41521/mcp" : `${window.location.origin}/mcp`;
}

type CopyTarget = "url" | "token" | "snippet";

// What the endpoint is doing, which is the whole of what the header varies on.
type Status = "listening" | "connecting" | "off" | "error";

/**
 * McpPopover is the panel behind the footer's plug: the endpoint at the top, the
 * clients down the left, and what one client costs on the right.
 *
 * The header's right-hand slot is what the endpoint's state is worth doing about, so
 * a web build with no session yet carries Connect where a live one carries the two
 * copy verbs, and a server that failed to start carries neither: there is no verb for
 * a port somebody else is holding, only the sentence saying so.
 */
export function McpPopover({ info, agent }: { info?: McpConnection; agent?: AgentFooter }) {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<CopyTarget>();
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const error = info?.error;
  const connected = !!info?.enabled && !!info.url;
  const status: Status = error ? "error" : !connected ? "off" : agent && !agent.attached ? "connecting" : "listening";
  const live = status === "listening" || status === "connecting";

  const client = mcpClients[selected];
  const endpoint: McpEndpoint = { url: connected ? info.url : idleUrl(), token: connected ? info.token : "" };
  const snippet = client.snippet(endpoint);
  const shown = client.snippet({ url: endpoint.url, token: elideToken(endpoint.token) });
  const configurationPath = client.configurationKey ? info?.configurationPaths?.[client.configurationKey] : undefined;
  const canReveal = live && isWailsEnvironment() && !!configurationPath;
  const webHint = live && !isWailsEnvironment() && !!client.configurationKey;

  const copy = (target: CopyTarget, text: string) => {
    void copyText(text).then((landed) => {
      if (!landed) return;
      clearTimeout(timeout.current);
      setCopied(target);
      timeout.current = setTimeout(() => setCopied(undefined), COPIED_MS);
    });
  };

  const install = () => {
    const link = client.install?.link(endpoint);
    if (!link) return;
    if (isWailsEnvironment()) {
      openInBrowser(link);
    } else {
      window.location.href = link;
    }
  };

  const note = noteFor(status, error, agent);

  return (
    <div className="flex w-[640px] flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status === "listening"
              ? "bg-emerald-500"
              : status === "connecting"
                ? "bg-amber-500"
                : status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground",
          )}
        />
        {error ? (
          // What went wrong is a sentence, and the header is one line: it says the
          // endpoint is dead and the note underneath says why.
          <span className="min-w-0 flex-1 truncate text-xs text-destructive">server not running</span>
        ) : live ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{endpoint.url}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">no session yet</span>
        )}
        {live && (
          <>
            <Verb label={copied === "url" ? "Copied URL" : "Copy URL"} lit={copied === "url"} onClick={() => copy("url", endpoint.url)} />
            <Divider />
            <Verb
              label={`${copied === "token" ? "Copied" : "Copy"} token ${elideToken(endpoint.token)}`}
              lit={copied === "token"}
              onClick={() => copy("token", endpoint.token)}
            />
          </>
        )}
        {agent?.connected && live && (
          <>
            <Divider />
            {/* Disconnecting rolls the token, so the one that was pasted somewhere names
                nothing afterwards. */}
            <Verb label="Disconnect" onClick={agent.disconnect} />
          </>
        )}
        {agent && !agent.connected && (
          <Button size="sm" onClick={agent.connect} className="shrink-0">
            Connect an agent
          </Button>
        )}
      </div>

      <div className="flex h-[262px]">
        <nav aria-label="MCP client" className="w-[180px] shrink-0 overflow-y-auto border-r border-border py-1.5">
          {mcpClients.map((c, index) => (
            <button
              key={c.name}
              type="button"
              aria-current={index === selected}
              onClick={() => setSelected(index)}
              className={cn(
                "flex h-[22px] w-full cursor-pointer items-center border-0 pl-3 pr-2 text-left text-xs",
                index === selected ? "bg-accent font-semibold text-accent-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/50",
              )}
            >
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{client.name}</span>
            <span className="shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">{client.kind}</span>
          </div>
          <p className="m-0 text-xs leading-normal text-pretty text-muted-foreground">{client.lead}</p>
          {client.install && live && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={install}>
                {client.install.label}
              </Button>
              <span className="text-xs text-muted-foreground">or by hand</span>
            </div>
          )}
          <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border", !live && "opacity-45")}>
            <div className="flex h-[26px] shrink-0 items-center gap-1 border-b border-border bg-muted/40 pl-2 pr-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{client.path}</span>
              {live && <Verb small label={copied === "snippet" ? "Copied" : "Copy"} lit={copied === "snippet"} onClick={() => copy("snippet", snippet)} />}
              {canReveal && (
                <>
                  <span className="h-3 w-px shrink-0 bg-border" />
                  <Verb small label="Reveal" onClick={() => void desktop().then((app) => app.ShowFileInFinder(configurationPath))} />
                </>
              )}
              {webHint && (
                <>
                  <span className="h-3 w-px shrink-0 bg-border" />
                  {/* A browser can't touch your filesystem, so the path is all Kaja can give you. */}
                  <span className="shrink-0 px-1.5 font-mono text-xs text-muted-foreground">open it yourself</span>
                </>
              )}
            </div>
            <pre className="m-0 min-h-0 flex-1 overflow-auto bg-muted/20 p-2.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
              {shown}
            </pre>
          </div>
          {note && (
            <p
              className={cn(
                "m-0 text-xs leading-normal text-pretty",
                note.tone === "amber" ? "text-amber-600 dark:text-amber-400" : note.tone === "destructive" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function noteFor(status: Status, error?: string, agent?: AgentFooter): { text: string; tone?: "amber" | "destructive" } | undefined {
  if (status === "error") return { text: error ?? "", tone: "destructive" };
  if (status === "off") {
    if (!agent) return { text: "The MCP server isn't running, so nothing here reaches this window yet." };
    return {
      text: "An agent can read this workspace's scripts, see what its apps can call, and run a script — in this window, which is where a script runs. Connect one and this browser gets a token of its own.",
    };
  }
  if (status === "connecting") return { text: agent?.error ?? "Connecting…", tone: "amber" };
  // Being on duty is what a window is unless it says otherwise, and a run's console is
  // held in the window that ran it — so the only thing worth a line is not being it.
  if (status === "listening" && agent?.attached && !agent.onDuty) {
    return { text: "Attached · another window of yours is on duty" };
  }
  return undefined;
}

function Divider() {
  return <span className="h-3.5 w-px shrink-0 bg-border" />;
}

// The chrome's smallest control, and a copy is its own receipt: the label swaps in
// place and the text goes to full weight while it holds. No toast, no icon change, no
// layout shift.
function Verb({ label, lit, small, onClick }: { label: string; lit?: boolean; small?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 cursor-pointer rounded border-0 bg-transparent px-1.5 font-mono text-xs hover:bg-accent",
        small ? "h-5" : "h-[22px]",
        lit ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}
