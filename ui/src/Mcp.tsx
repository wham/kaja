import { Copy, RefreshCw, RotateCw, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Switch } from "./components/switch";
import { McpMap } from "./McpMap";
import { mcpAgents, type McpEndpoint } from "./mcpAgents";
import { isListening, mcpDotClass, mcpStatusOf, type McpConnection, type McpControl } from "./mcpState";
import { desktop, isWailsEnvironment, openInBrowser } from "./wails";

// A copy verb is its own receipt: the label swaps in place for this long, and nothing
// else about the page moves.
const COPIED_MS = 1500;

// Regenerating invalidates every config already pasted, so the button says that before
// it acts and forgets it was asked this long after.
const ARMED_MS = 4000;

// The address this build answers on, which is what the page names before a server has
// reported one of its own.
function idleUrl(): string {
  return isWailsEnvironment() ? "http://127.0.0.1:41521/mcp" : `${window.location.origin}/mcp`;
}

type CopyTarget = "url" | "token" | "snippet";

/**
 * The MCP server's page: the server at the top, and under it how an agent reaches it.
 *
 * It reads top to bottom as one sentence. The band carries the two strings you have to
 * move by hand — the endpoint and the token — and the switch that owns the server. The
 * token is shown in full: it is a loopback credential you are about to paste into a
 * config file, so masking it only adds a click.
 *
 * **Off, the list gives way to the map.** A screenful of configuration per agent only
 * means something once there is a server to point one at, so the space says what the
 * switch is for instead — an agent, Kaja's canvas, the four protocols. The band is
 * unchanged either way: the endpoint and the token are the workspace's address rather
 * than the server's, so they stay copyable while nothing is listening.
 */
export function Mcp({ info, control, active }: { info?: McpConnection; control: McpControl; active: boolean }) {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<CopyTarget>();
  const [armed, setArmed] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const armTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(copyTimeout.current);
      clearTimeout(armTimeout.current);
    },
    [],
  );

  const listening = isListening(info);
  const status = mcpStatusOf(info, control, active);

  const agent = mcpAgents[selected];
  // The token is the workspace's address on the desktop and this browser's on the web,
  // and on neither is it the server's: a stopped server still has the one every pasted
  // configuration names, which is why the band states both with the switch off.
  const endpoint: McpEndpoint = { url: info?.url || idleUrl(), token: info?.token ?? "" };
  const snippet = agent.snippet(endpoint);
  const configurationPath = agent.configurationKey ? info?.configurationPaths?.[agent.configurationKey] : undefined;
  const canReveal = isWailsEnvironment() && !!configurationPath;
  const written = !!endpoint.token;

  const copy = (target: CopyTarget, text: string) => {
    void copyText(text).then((landed) => {
      if (!landed) return;
      clearTimeout(copyTimeout.current);
      setCopied(target);
      copyTimeout.current = setTimeout(() => setCopied(undefined), COPIED_MS);
    });
  };

  const regenerate = () => {
    clearTimeout(armTimeout.current);
    if (!armed) {
      setArmed(true);
      armTimeout.current = setTimeout(() => setArmed(false), ARMED_MS);
      return;
    }
    setArmed(false);
    control.regenerateToken();
  };

  const install = () => {
    const link = agent.install?.link(endpoint);
    if (!link) return;
    if (isWailsEnvironment()) {
      openInBrowser(link);
    } else {
      window.location.href = link;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden bg-background px-5 py-[18px]">
      <section aria-label="MCP server" className="flex shrink-0 flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3">
        <div className="flex items-center gap-2">
          {/* Held even when the glow has taken the dot's job, so the headline never steps sideways. */}
          <span className={cn("size-[7px] shrink-0 rounded-full", mcpDotClass(status.state) ?? "bg-transparent")} />
          <span className={cn("shrink-0 text-sm font-semibold", status.tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
            {status.headline}
          </span>
          {status.note && (
            <span className={cn("min-w-0 truncate text-xs", status.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>{status.note}</span>
          )}
          <span className="flex-1" />
          {status.state === "error" && <Verb icon={RotateCw} label="Retry" onClick={() => control.setEnabled(true)} />}
          <span className="shrink-0 text-xs text-muted-foreground">{control.enabled ? "on" : "off"}</span>
          <Switch checked={control.enabled} onCheckedChange={(checked) => control.setEnabled(checked === true)} aria-label="Enable MCP server" />
        </div>
        <div className="flex items-end gap-7">
          <Field label="endpoint" value={endpoint.url} lit={listening} copied={copied === "url"} onCopy={() => copy("url", endpoint.url)} />
          <Field
            label="token"
            value={written ? endpoint.token : "not set"}
            lit={listening}
            copied={copied === "token"}
            onCopy={written ? () => copy("token", endpoint.token) : undefined}
          />
          <span className="flex-1" />
          {written && <Verb icon={RefreshCw} label={armed ? "Replaces every pasted config" : "Regenerate token"} lit={armed} onClick={regenerate} />}
        </div>
      </section>

      {!control.enabled ? (
        <section
          aria-label="How Kaja works"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[22px] overflow-hidden rounded-lg border border-dashed border-border p-6"
        >
          <McpMap className="max-h-full w-full max-w-[880px]" />
          <p className="m-0 max-w-[520px] shrink-0 text-center text-xs leading-[1.6] text-pretty text-muted-foreground">
            Turn the server on and this panel lists the {mcpAgents.length} agents with a config to paste for each.
          </p>
        </section>
      ) : (
        <section aria-label="Connect an agent" className="flex min-h-0 flex-1 flex-col gap-2">
          <h2 className="m-0 shrink-0 text-xs font-semibold text-foreground">Connect an agent</h2>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
            <nav aria-label="MCP agent" className="w-[176px] shrink-0 overflow-y-auto border-r border-border py-[5px]">
              {mcpAgents.map((candidate, index) => (
                <button
                  key={candidate.name}
                  type="button"
                  aria-current={index === selected}
                  onClick={() => setSelected(index)}
                  className={cn(
                    "flex h-[26px] w-full cursor-pointer items-center border-0 px-2.5 text-left text-xs",
                    index === selected ? "bg-accent font-semibold text-accent-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <span className="truncate">{candidate.name}</span>
                </button>
              ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-4 py-3.5">
              <div className="flex min-h-8 items-center gap-2">
                <span className="shrink-0 truncate text-sm font-semibold text-foreground">{agent.name}</span>
                <span className="shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">{agent.kind}</span>
                <span className="flex-1" />
                {agent.install && written && (
                  <Button size="sm" onClick={install}>
                    {agent.install.label}
                  </Button>
                )}
              </div>
              <p className="m-0 text-xs leading-[1.6] text-pretty text-muted-foreground">{agent.lead}</p>
              <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border", !written && "opacity-45")}>
                <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border bg-muted pl-2.5 pr-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{agent.path}</span>
                  {written && <Verb label={copied === "snippet" ? "Copied" : "Copy"} lit={copied === "snippet"} onClick={() => copy("snippet", snippet)} />}
                  {canReveal && (
                    <>
                      <span className="h-3 w-px shrink-0 bg-border" />
                      <Verb label="Reveal" onClick={() => void desktop().then((app) => app.ShowFileInFinder(configurationPath))} />
                    </>
                  )}
                </div>
                <pre className="m-0 min-h-0 flex-1 overflow-auto bg-card px-4 py-3.5 font-mono text-xs leading-[1.75] break-words whitespace-pre-wrap text-foreground">
                  {snippet}
                </pre>
              </div>
              {agent.foot && <p className="m-0 text-xs leading-[1.6] text-pretty text-muted-foreground">{agent.foot}</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// One of the two strings you have to move by hand, where a form's identity fields
// always are.
function Field({ label, value, lit, copied, onCopy }: { label: string; value: string; lit: boolean; copied: boolean; onCopy?: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="font-mono text-[9.5px] tracking-[0.11em] text-muted-foreground uppercase">{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        <span className={cn("truncate font-mono text-xs", lit ? "text-foreground" : "text-muted-foreground")}>{value}</span>
        {onCopy && (
          <IconButton
            size="xs"
            variant="ghost"
            tooltip="native"
            icon={Copy}
            aria-label={copied ? `Copied the ${label}` : `Copy the ${label}`}
            className={cn("h-5 w-5 [&_svg]:size-3", copied && "text-foreground")}
            onClick={onCopy}
          />
        )}
      </div>
    </div>
  );
}

// The page's smallest control, and a copy is its own receipt: the label swaps in place
// and the text goes to full weight while it holds. No toast, no icon change, no layout
// shift.
function Verb({ icon: Icon, label, lit, onClick }: { icon?: LucideIcon; label: string; lit?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[22px] shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1.5 font-mono text-xs hover:bg-accent",
        lit ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </button>
  );
}
