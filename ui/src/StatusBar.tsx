import { Fragment, useState } from "react";
import { GitBranch, MessagesSquare, Moon, Sun, Plug } from "lucide-react";
import { copyText } from "./clipboard";
import { cn } from "./cn";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { SegmentedControl } from "./components/segmented-control";
import { isWailsEnvironment } from "./wails";
import { desktop, openInBrowser } from "./wails";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { CompileStatus } from "./CompileStatus";
import { summarizeCompilation } from "./compileSummary";
import { App } from "./apps";

export type ColorMode = "day" | "night";

// Every icon in the status bar is the same 14px glyph on the same hit area.
export const statusBarIconClass = "h-6 w-6 [&_svg]:size-[14px]";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
  buildNumber?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  mcpInfo?: McpConnection;
  mcpActive?: boolean;
  agent?: AgentFooter;
  apps: App[];
  configurationLoaded: boolean;
  onShowCompileLog: (appName?: string) => void;
  onRecompile: (appName?: string) => void;
}

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

// McpClient is one way to connect an agent to the MCP server. Add one here and it
// shows up as another tab in the popup.
interface McpClient {
  label: string;
  // The file the snippet is pasted into: the key the desktop resolved a path under, and
  // the name to fall back to when it couldn't. A client told to run a command has none.
  configuration?: { key: string; name: string };
  // hint is handed the configuration file it names — a link that reveals it, or its
  // bare name — so the sentence around it stays with the client it belongs to.
  hint: (file: React.ReactNode) => React.ReactNode;
  snippet: (info: McpConnection) => string;
}

const mcpClients: McpClient[] = [
  {
    label: "Claude Code",
    hint: () => "Run this command to add the server to the CLI:",
    snippet: (info) => `claude mcp add --transport http kaja ${info.url} --header "Authorization: Bearer ${info.token}"`,
  },
  {
    // The connector UI connects from Anthropic's servers, which can't reach localhost, so
    // Desktop goes through the mcp-remote stdio bridge instead. The header is passed via
    // an env var because Claude Desktop splits args on spaces, which would otherwise
    // mangle "Bearer <token>".
    label: "Claude Desktop",
    configuration: { key: "claudeDesktop", name: "claude_desktop_config.json" },
    hint: (file) => <>Add this to {file}, which bridges through mcp-remote:</>,
    snippet: (info) =>
      JSON.stringify(
        {
          mcpServers: {
            kaja: {
              command: "npx",
              args: ["mcp-remote", info.url, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${info.token}` },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    // Cursor talks to the server itself, so it takes the endpoint and the token as they
    // are — no bridge, unlike Claude Desktop.
    label: "Cursor",
    configuration: { key: "cursor", name: "mcp.json" },
    hint: (file) => <>Add this to {file}:</>,
    snippet: (info) =>
      JSON.stringify(
        {
          mcpServers: {
            kaja: {
              type: "http",
              url: info.url,
              headers: { Authorization: `Bearer ${info.token}` },
            },
          },
        },
        null,
        2,
      ),
  },
];

// Opens the file in the system file browser with the file selected. A file the client
// hasn't written yet opens its directory.
function ConfigurationFileLink({ path }: { path: string }) {
  return (
    <button
      type="button"
      onClick={() => void desktop().then((app) => app.ShowFileInFinder(path))}
      className="cursor-pointer break-all border-0 bg-transparent p-0 text-left font-mono text-[11px] text-foreground underline underline-offset-2 hover:text-foreground/80"
    >
      {path}
    </button>
  );
}

// MCPStatus surfaces the MCP endpoint and, per client, the snippet to connect it to
// an agent. On the desktop there is always an endpoint; on the web there is one only
// once this browser has connected, and until then the popup is the offer to.
//
// `active` is an agent talking to the server right now.
function MCPStatus({ info, active, agent }: { info?: McpConnection; active: boolean; agent?: AgentFooter }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const client = mcpClients[selected];
  const snippet = info ? client.snippet(info) : "";
  const configurationPath = client.configuration ? info?.configurationPaths?.[client.configuration.key] : undefined;
  const configurationFile = client.configuration ? (
    configurationPath ? (
      <ConfigurationFileLink path={configurationPath} />
    ) : (
      <span className="font-mono text-[11px] text-foreground">{client.configuration.name}</span>
    )
  ) : null;

  const select = (index: number) => {
    setSelected(index);
    setCopied(false);
  };

  const copy = () => {
    void copyText(snippet).then((landed) => {
      if (!landed) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="relative inline-flex">
        {active && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border border-emerald-500/70 animate-signal motion-reduce:animate-none motion-reduce:opacity-60"
          />
        )}
        <PopoverTrigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            tooltip={false}
            icon={Plug}
            aria-label={active ? "MCP server · in use" : agent && !agent.connected ? "MCP server · connect an agent" : "MCP server"}
            className={cn(statusBarIconClass, active && "text-emerald-600 dark:text-emerald-400")}
          />
        </PopoverTrigger>
      </span>
      <PopoverContent align="end" side="top" className="p-3">
        <div className="flex max-w-[420px] flex-col gap-2">
          <span className="text-xs font-semibold text-foreground">MCP server</span>
          {info ? (
            <>
              <SegmentedControl aria-label="MCP client">
                {mcpClients.map((c, index) => (
                  <SegmentedControl.Button key={c.label} selected={index === selected} onClick={() => select(index)}>
                    {c.label}
                  </SegmentedControl.Button>
                ))}
              </SegmentedControl>
              <span className="text-[11px] text-muted-foreground">{client.hint(configurationFile)}</span>
              <pre className="m-0 whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{snippet}</pre>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              An agent can read this workspace's scripts, see what its apps can call, and run a script — in this window, which is where a script runs. Connect
              one and this browser gets a token of its own.
            </span>
          )}
          {agent && <AgentSessionRow agent={agent} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// AgentSessionRow is the state of this browser's session and the one verb that
// changes it. Which window is on duty is stated too, because a run's console is held
// in the window that ran it.
function AgentSessionRow({ agent }: { agent: AgentFooter }) {
  const status = !agent.connected
    ? undefined
    : agent.attached
      ? agent.onDuty
        ? "Attached · runs land in this window"
        : "Attached · another window of yours is on duty"
      : (agent.error ?? "Connecting…");

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
      <span className={cn("text-[11px]", agent.connected && !agent.attached ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{status}</span>
      {agent.connected ? (
        // Disconnecting rolls the token, so the one that was pasted somewhere names nothing
        // afterwards.
        <Button variant="ghost" size="sm" onClick={agent.disconnect}>
          Disconnect
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={agent.connect}>
          Connect an agent
        </Button>
      )}
    </div>
  );
}

// MCPError surfaces a server that couldn't start (e.g. the fixed port is in use). It
// reuses the plug icon so the footer keeps the same shape.
function MCPError({ message }: { message: string }) {
  return <IconButton size="xs" variant="ghost" tooltip={false} icon={Plug} aria-label={message} className={cn(statusBarIconClass, "text-destructive")} />;
}

function openFeedback() {
  const url = "https://github.com/wham/kaja/issues/new?template=feedback.yml";
  if (isWailsEnvironment()) {
    openInBrowser(url);
  } else {
    window.open(url, "_blank");
  }
}

export function StatusBar({
  colorMode,
  onToggleColorMode,
  gitRef,
  buildNumber,
  featurePreviews,
  onToggleFeaturePreview,
  mcpInfo,
  mcpActive = false,
  agent,
  apps,
  configurationLoaded,
  onShowCompileLog,
  onRecompile,
}: StatusBarProps) {
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const githubUrl = gitRef ? `https://github.com/wham/kaja/tree/${gitRef}` : undefined;

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isWailsEnvironment() && githubUrl) {
      e.preventDefault();
      openInBrowser(githubUrl);
    }
  };

  // The compile status sits at the end so its label can grow and shrink without moving
  // the ref and the build around.
  const leftItems: React.ReactNode[] = [];
  if (githubUrl && shortRef) {
    leftItems.push(
      <a
        key="ref"
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleLinkClick}
        className="inline-flex items-center gap-2 text-xs text-muted-foreground no-underline hover:text-foreground"
      >
        <GitBranch size={14} />
        <span>{shortRef}</span>
      </a>,
    );
  }
  if (buildNumber) {
    leftItems.push(
      <span key="build" className="font-mono text-xs text-muted-foreground">
        build {buildNumber}
      </span>,
    );
  }
  if (summarizeCompilation(apps, configurationLoaded).state !== "empty") {
    leftItems.push(
      <CompileStatus key="compile" apps={apps} configurationLoaded={configurationLoaded} onShowLog={onShowCompileLog} onRecompile={onRecompile} />,
    );
  }

  // The right padding is 11, not 12: these glyphs are smaller than the rest of the
  // chrome's, so they need one pixel less to land on the same 16px right line.
  //
  // sticky left keeps the bar where the window is on a screen too narrow to hold the
  // panes side by side: the app pans horizontally there, and a footer that pans with it
  // takes its own buttons off the screen.
  return (
    <div className="sticky left-0 flex h-[30px] shrink-0 items-center border-t border-border bg-chrome pl-3 pr-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        {leftItems.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <div className="h-3 w-px shrink-0 bg-border" />}
            {item}
          </Fragment>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {(agent || (mcpInfo?.enabled && mcpInfo.url)) && (
          <MCPStatus info={mcpInfo?.enabled && mcpInfo.url ? mcpInfo : undefined} active={mcpActive} agent={agent} />
        )}
        {mcpInfo?.error && <MCPError message={mcpInfo.error} />}
        <IconButton size="xs" variant="ghost" icon={MessagesSquare} aria-label="Feedback" onClick={openFeedback} className={statusBarIconClass} />
        <FeaturePreviews features={featurePreviews} onToggle={onToggleFeaturePreview} className={statusBarIconClass} />
        <IconButton
          size="xs"
          variant="ghost"
          tooltip={false}
          icon={colorMode === "night" ? Sun : Moon}
          aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleColorMode}
          className={statusBarIconClass}
        />
      </div>
    </div>
  );
}
