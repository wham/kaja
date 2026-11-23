import { Check, ChevronsUpDown, Copy, RefreshCw, RotateCw, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Button } from "./components/button";
import { Checkbox } from "./components/checkbox";
import { IconButton } from "./components/icon-button";
import { Switch } from "./components/switch";
import { containerUrl, mcpAgents, type McpAgent, type McpAgentKind, type McpEndpoint } from "./mcpAgents";
import { isListening, mcpDotClass, mcpStatusOf, type McpConnection, type McpControl } from "./mcpState";
import { PHONE_QUERY } from "./phone";
import { useMediaQuery } from "./useMediaQuery";
import { desktop, isIOSApp, isWailsEnvironment, openInBrowser } from "./wails";

// A copy verb is its own receipt: the label swaps in place for this long, and nothing
// else about the page moves.
const COPIED_MS = 1500;

// Regenerating invalidates every config already pasted, so the button says that before
// it acts and forgets it was asked this long after.
const ARMED_MS = 4000;

// The address this build answers on, which is what the page names before a server has
// reported one of its own.
export function idleUrl(): string {
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
 * **The list is there whether the server is on or off.** What the switch decides is
 * whether anyone can reach the endpoint, never what it is or which agents can be
 * pointed at it — so the page reads the same either way, and the band's endpoint and
 * token stay copyable while nothing is listening. What Kaja is for is said on the empty
 * state, which is the screen that has nothing else to say.
 */
export function Mcp({ info, control, active }: { info?: McpConnection; control: McpControl; active: boolean }) {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState<CopyTarget>();
  const [armed, setArmed] = useState(false);
  const [inContainer, setInContainer] = useState(false);
  const phone = useMediaQuery(PHONE_QUERY);
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
  const fromContainer = agent.container ? containerUrl(endpoint.url) : undefined;
  const agentEndpoint = fromContainer && inContainer ? { ...endpoint, url: fromContainer } : endpoint;
  const snippet = agent.snippet(agentEndpoint);
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
    const link = agent.install?.link(agentEndpoint);
    if (!link) return;
    if (isWailsEnvironment()) {
      openInBrowser(link);
    } else {
      window.location.href = link;
    }
  };

  if (phone) {
    const group = "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card";
    const copyButton = (target: CopyTarget, label: string, text: string) => (
      <button
        type="button"
        aria-label={copied === target ? `Copied the ${label}` : `Copy the ${label}`}
        onClick={() => copy(target, text)}
        className={cn(
          "-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full active:bg-accent",
          copied === target ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {copied === target ? <Check size={18} /> : <Copy size={18} />}
      </button>
    );
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain bg-background p-4">
        <section aria-label="MCP server" className={group}>
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[16px] font-medium">
                <span className={cn("size-[7px] shrink-0 rounded-full", mcpDotClass(status.state) ?? "bg-muted-foreground/40")} />
                <span className={cn(status.tone === "emerald" && "text-emerald-600 dark:text-emerald-400")}>{status.headline}</span>
              </div>
              {status.note && (
                <div className={cn("text-[13px] break-words", status.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>{status.note}</div>
              )}
            </div>
            <Switch checked={control.enabled} onCheckedChange={(checked) => control.setEnabled(checked === true)} aria-label="Enable MCP server" />
          </div>
          <div className="flex min-h-14 items-center gap-2 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-muted-foreground">Endpoint</div>
              <div className={cn("font-mono text-[13px] break-all", !listening && "text-muted-foreground")}>{endpoint.url}</div>
            </div>
            {copyButton("url", "endpoint", endpoint.url)}
          </div>
          <div className="flex min-h-14 items-center gap-2 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-muted-foreground">Token</div>
              <div className={cn("truncate font-mono text-[13px]", !listening && "text-muted-foreground")}>{written ? endpoint.token : "not set"}</div>
            </div>
            {written && copyButton("token", "token", endpoint.token)}
          </div>
          {written && (
            <button type="button" onClick={regenerate} className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] active:bg-accent">
              <RefreshCw size={17} className="shrink-0 text-muted-foreground" />
              {armed ? "Replaces every pasted config. Tap again" : "Regenerate token"}
            </button>
          )}
          {status.state === "error" && (
            <button
              type="button"
              onClick={() => control.setEnabled(true)}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] active:bg-accent"
            >
              <RotateCw size={17} className="shrink-0 text-muted-foreground" />
              Retry
            </button>
          )}
        </section>
        {isIOSApp() && <p className="-mt-2 px-1 text-[13px] text-muted-foreground">On an iPhone nothing outside Kaja can reach this endpoint.</p>}

        <section aria-label={agent.name} className="flex flex-col gap-3">
          {/* The system's own picker: a list of fifteen names is what it is for, and a column of them beside the snippet left the snippet no width. */}
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-card px-4 text-[16px]">
            <span className="shrink-0">Agent</span>
            <select
              aria-label="MCP agent"
              value={selected}
              onChange={(event) => setSelected(Number(event.target.value))}
              className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-right text-muted-foreground outline-none"
              dir="rtl"
            >
              {agentGroups.map((candidateGroup) => (
                <optgroup key={candidateGroup.kind} label={candidateGroup.label}>
                  {mcpAgents.map(
                    (candidate, index) =>
                      candidate.kind === candidateGroup.kind && (
                        <option key={candidate.name} value={index}>
                          {candidate.name}
                        </option>
                      ),
                  )}
                </optgroup>
              ))}
            </select>
            <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" />
          </label>
          {agent.install && written && (
            <Button className="h-[50px] rounded-xl text-[17px]" onClick={install}>
              {agent.install.label}
            </Button>
          )}
          <p className="m-0 px-1 text-[13px] leading-[1.5] text-pretty text-muted-foreground">
            {where(agent)}
            {agent.file && <span className="font-mono text-foreground"> {agent.file}</span>}.{agent.note && ` ${agent.note}`}
          </p>
          {fromContainer && (
            <label className="flex min-h-11 items-center gap-3 px-1 text-[15px] text-foreground">
              <Checkbox checked={inContainer} onCheckedChange={(checked) => setInContainer(checked === true)} />
              {agent.name} runs in a dev container
            </label>
          )}
          <pre
            className={cn(
              "m-0 overflow-x-auto rounded-xl bg-card p-4 font-mono text-[12px] leading-[1.7] break-all whitespace-pre-wrap text-foreground",
              !written && "opacity-45",
            )}
          >
            {snippet}
          </pre>
          {written && (
            <Button variant="secondary" className="h-[50px] rounded-xl text-[17px]" onClick={() => copy("snippet", snippet)}>
              {copied === "snippet" ? <Check size={18} /> : <Copy size={18} />}
              {copied === "snippet" ? "Copied" : "Copy"}
            </Button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <section aria-label="MCP server" className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Switch checked={control.enabled} onCheckedChange={(checked) => control.setEnabled(checked === true)} aria-label="Enable MCP server" />
          {/* Held even when the glow has taken the dot's job, so the headline never steps sideways. */}
          <span className={cn("size-[7px] shrink-0 rounded-full", mcpDotClass(status.state) ?? "bg-transparent")} />
          <span className={cn("shrink-0 text-xs font-semibold", status.tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
            {status.headline}
          </span>
          {status.note && (
            <span className={cn("min-w-0 truncate text-xs", status.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>{status.note}</span>
          )}
          {status.state === "error" && <Verb icon={RotateCw} label="Retry" onClick={() => control.setEnabled(true)} />}
        </div>
        <Field label="Endpoint" value={endpoint.url} lit={listening} copied={copied === "url"} onCopy={() => copy("url", endpoint.url)} />
        <div className="flex min-w-0 items-center gap-1">
          <Field
            label="Token"
            value={written ? endpoint.token : "not set"}
            lit={listening}
            copied={copied === "token"}
            onCopy={written ? () => copy("token", endpoint.token) : undefined}
          />
          {written && <Verb icon={RefreshCw} label={armed ? "Replaces every pasted config" : "Regenerate"} lit={armed} onClick={regenerate} />}
        </div>
      </section>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav aria-label="MCP agent" className="flex w-[200px] shrink-0 flex-col gap-5 overflow-y-auto py-4 pr-3 pl-5">
          {agentGroups.map((group) => (
            <div key={group.kind} className="flex flex-col gap-px">
              <span className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/70">{group.label}</span>
              {mcpAgents.map(
                (candidate, index) =>
                  candidate.kind === group.kind && (
                    <button
                      key={candidate.name}
                      type="button"
                      aria-current={index === selected}
                      onClick={() => setSelected(index)}
                      className={cn(
                        "flex h-[26px] w-full shrink-0 cursor-pointer items-center rounded-md border-0 px-2 text-left text-xs",
                        index === selected ? "bg-accent font-semibold text-accent-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <span className="truncate">{candidate.name}</span>
                    </button>
                  ),
              )}
            </div>
          ))}
        </nav>

        <section aria-label={agent.name} className="flex min-w-0 flex-1 flex-col gap-2.5 py-4 pr-5 pl-4">
          <div className="flex min-h-8 items-center gap-2">
            <h2 className="m-0 min-w-0 truncate text-base font-semibold text-foreground">{agent.name}</h2>
            <span className="flex-1" />
            {agent.install && written && (
              <Button size="sm" onClick={install}>
                {agent.install.label}
              </Button>
            )}
          </div>
          <p className="m-0 text-xs leading-[1.6] text-pretty text-muted-foreground">
            {where(agent)}
            {agent.file && <span className="font-mono text-foreground"> {agent.file}</span>}.{agent.note && ` ${agent.note}`}
          </p>
          {fromContainer && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox checked={inContainer} onCheckedChange={(checked) => setInContainer(checked === true)} />
              {agent.name} runs in a dev container
              <span className="text-muted-foreground">reaches Kaja at host.docker.internal</span>
            </label>
          )}
          <div className={cn("relative mt-1.5 flex min-h-0 flex-1", !written && "opacity-45")}>
            <pre className="m-0 min-h-0 flex-1 overflow-auto rounded-lg bg-card py-3.5 pr-36 pl-4 font-mono text-xs leading-[1.75] break-words whitespace-pre-wrap text-foreground">
              {snippet}
            </pre>
            <div className="absolute top-2 right-2 flex gap-1">
              {canReveal && <Verb label="Reveal" pill onClick={() => void desktop().then((app) => app.ShowFileInFinder(configurationPath))} />}
              {written && <Verb label={copied === "snippet" ? "Copied" : "Copy"} lit={copied === "snippet"} pill onClick={() => copy("snippet", snippet)} />}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const agentGroups: { kind: McpAgentKind; label: string }[] = [
  { kind: "one-click install", label: "One click" },
  { kind: "terminal command", label: "Terminal" },
  { kind: "config file", label: "Config file" },
];

// A one-click agent's snippet is the fallback under its button.
function where(agent: McpAgent): string {
  const lead = agent.file ? "paste into" : "run in a terminal";
  return agent.install ? `Or ${lead}` : lead[0].toUpperCase() + lead.slice(1);
}

// One of the two strings you have to move by hand.
function Field({ label, value, lit, copied, onCopy }: { label: string; value: string; lit: boolean; copied: boolean; onCopy?: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate font-mono text-xs", lit ? "text-foreground" : "text-muted-foreground")}>{value}</span>
      {onCopy && (
        <IconButton
          size="xs"
          variant="ghost"
          tooltip="native"
          icon={copied ? Check : Copy}
          aria-label={copied ? `Copied the ${label.toLowerCase()}` : `Copy the ${label.toLowerCase()}`}
          className={cn("h-5 w-5 [&_svg]:size-3", copied && "text-emerald-600 dark:text-emerald-400")}
          onClick={onCopy}
        />
      )}
    </div>
  );
}

// The page's smallest control, and a copy is its own receipt: the label swaps in place
// and the text goes to full weight while it holds. No toast, no icon change, no layout
// shift.
function Verb({ icon: Icon, label, lit, pill, onClick }: { icon?: LucideIcon; label: string; lit?: boolean; pill?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[22px] shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 px-1.5 font-mono text-xs hover:bg-accent",
        pill ? "bg-muted px-2" : "bg-transparent",
        lit ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </button>
  );
}
