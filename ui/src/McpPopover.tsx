import { useEffect, useRef, useState } from "react";

import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Button } from "./components/button";
import { Switch } from "./components/switch";
import { mcpClients, type McpEndpoint } from "./mcpClients";
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

// McpControl is the shared switch and the window attachment it controls.
export interface McpControl {
  enabled: boolean;
  attached: boolean;
  onDuty: boolean;
  error?: string;
  setEnabled: (enabled: boolean) => void;
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

type CopyTarget = "snippet";

// What the endpoint is doing, which is the whole of what the header varies on.
type Status = "listening" | "connecting" | "off" | "error";

/**
 * McpPopover is the panel behind the footer's plug: the endpoint at the top, the
 * clients down the left, and what one client costs on the right.
 *
 * The switch owns the server on both builds; once it is on, the rail and pane describe
 * the one configuration a selected client needs.
 */
export function McpPopover({ info, control }: { info?: McpConnection; control: McpControl }) {
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      mcpClients.findIndex((client) => client.name === "Cursor"),
    ),
  );
  const [copied, setCopied] = useState<CopyTarget>();
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const error = info?.error || control.error;
  const connected = !!info?.enabled && !!info.url;
  const status: Status = error ? "error" : !control.enabled ? "off" : !connected || !control.attached ? "connecting" : "listening";
  const live = status === "listening" || status === "connecting";

  const client = mcpClients[selected];
  const endpoint: McpEndpoint = { url: connected ? info.url : idleUrl(), token: connected ? info.token : "" };
  const snippet = client.snippet(endpoint);
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

  const note = noteFor(status, error, control);

  return (
    <div className="flex w-[760px] flex-col">
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
        <span className="shrink-0 text-sm font-semibold text-foreground">MCP server</span>
        <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {live ? endpoint.url : "not running"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{control.enabled ? "on" : "off"}</span>
        <Switch checked={control.enabled} onCheckedChange={(checked) => control.setEnabled(checked === true)} aria-label="Enable MCP server" />
      </div>

      {!control.enabled ? (
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0 max-w-[560px] text-sm leading-[1.55] text-pretty text-foreground">
            Turn the server on to let a coding agent work with this workspace: read your scripts, see what each app&apos;s services can call, and run a script
            here in this window.
          </p>
          <p className="m-0 max-w-[560px] text-xs leading-[1.55] text-pretty text-muted-foreground">
            {isWailsEnvironment()
              ? "Kaja listens on loopback only, so nothing outside this Mac can reach it."
              : "In the browser the server runs inside this tab, so it stops when you close it and the token is new each time."}
          </p>
          <p className="m-0 text-xs text-muted-foreground">
            Setup examples for Claude Code, Cursor, VS Code, Claude Desktop and six more appear once it&apos;s running.
          </p>
          {note && <p className="m-0 text-xs leading-normal text-destructive">{note.text}</p>}
        </div>
      ) : (
        <div className="flex h-[360px]">
          <nav aria-label="MCP client" className="w-[190px] shrink-0 overflow-y-auto border-r border-border py-1.5">
            {mcpClients.map((c, index) => (
              <button
                key={c.name}
                type="button"
                aria-current={index === selected}
                onClick={() => setSelected(index)}
                className={cn(
                  "flex h-6 w-full cursor-pointer items-center border-0 pl-3 pr-2 text-left text-xs",
                  index === selected ? "bg-accent font-semibold text-accent-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/50",
                )}
              >
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
            <div className="flex min-h-8 items-center gap-2">
              <span className="shrink-0 truncate text-sm font-medium text-foreground">{client.name}</span>
              <span className="shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">{client.kind}</span>
              <span className="flex-1" />
              {client.install && live && (
                <>
                  <span className="text-xs text-muted-foreground">or by hand below</span>
                  <Button size="sm" onClick={install}>
                    {client.install.label}
                  </Button>
                </>
              )}
            </div>
            <p className="m-0 text-xs leading-[1.55] text-pretty text-muted-foreground">{client.lead}</p>
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
              <pre className="m-0 min-h-0 flex-1 overflow-auto bg-muted/20 p-3 font-mono text-xs leading-[1.7] break-words whitespace-pre-wrap text-foreground">
                {snippet}
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
      )}
    </div>
  );
}

function noteFor(status: Status, error: string | undefined, control: McpControl): { text: string; tone?: "amber" | "destructive" } | undefined {
  if (status === "error") return { text: error ?? "", tone: "destructive" };
  if (status === "connecting") return { text: control.error ?? "Connecting…", tone: "amber" };
  // Being on duty is what a window is unless it says otherwise, and a run's console is
  // held in the window that ran it — so the only thing worth a line is not being it.
  if (status === "listening" && control.attached && !control.onDuty) {
    return { text: "Attached · another window of yours is on duty" };
  }
  return undefined;
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
