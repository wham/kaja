import { Fragment, useState } from "react";
import { GitBranch, MessagesSquare, Moon, Sun, Plug } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { SegmentedControl } from "./components/segmented-control";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL } from "./wailsjs/runtime/runtime";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { CompileStatus } from "./CompileStatus";
import { summarizeCompilation } from "./compileSummary";
import { App } from "./apps";
import { main } from "./wailsjs/go/models";

export type ColorMode = "day" | "night";

// Every icon in the status bar is the same 14px glyph on the same hit area; the
// row has no per-icon size overrides and no vertical offsets.
export const statusBarIconClass = "h-6 w-6 [&_svg]:size-[14px]";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
  buildNumber?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  mcpInfo?: main.MCPInfo;
  mcpActive?: boolean;
  apps: App[];
  configurationLoaded: boolean;
  onShowCompileLog: (appName?: string) => void;
  onRecompile: (appName?: string) => void;
}

// McpClient is one way to connect an agent to the local MCP server. Each client
// turns the live endpoint + token into a copy-pasteable snippet. Add new clients
// here and they show up as another tab in the popup.
interface McpClient {
  label: string;
  hint: string;
  // snippet renders the connection instructions for the running server.
  snippet: (info: main.MCPInfo) => string;
}

const mcpClients: McpClient[] = [
  {
    label: "Claude Code",
    hint: "Run this command to add the server to the CLI:",
    snippet: (info) => `claude mcp add --transport http kaja ${info.url} --header "Authorization: Bearer ${info.token}"`,
  },
  {
    // The connector UI connects from Anthropic's servers, which can't reach
    // localhost, so Desktop goes through the mcp-remote stdio bridge instead.
    // The header is passed via an env var because Claude Desktop splits args on
    // spaces, which would otherwise mangle "Bearer <token>".
    label: "Claude Desktop",
    hint: "Add this to claude_desktop_config.json (bridges through mcp-remote):",
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
];

// MCPStatus surfaces the localhost MCP endpoint and, per client, the snippet to
// connect it to an agent. Shown only while the MCP feature preview is on.
//
// `active` is an agent talking to the server right now: the plug goes emerald
// and a ring pings out of it, which is the one thing in the footer that says
// something is happening somewhere you aren't looking.
function MCPStatus({ info, active }: { info: main.MCPInfo; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const client = mcpClients[selected];
  const snippet = client.snippet(info);

  const select = (index: number) => {
    setSelected(index);
    setCopied(false);
  };

  const copy = () => {
    navigator.clipboard?.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
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
            aria-label={active ? "MCP server · in use" : "MCP server"}
            className={cn(statusBarIconClass, active && "text-emerald-600 dark:text-emerald-400")}
          />
        </PopoverTrigger>
      </span>
      <PopoverContent align="end" side="top" className="p-3">
        <div className="flex max-w-[420px] flex-col gap-2">
          <span className="text-xs font-semibold text-foreground">MCP server</span>
          <SegmentedControl aria-label="MCP client">
            {mcpClients.map((c, index) => (
              <SegmentedControl.Button key={c.label} selected={index === selected} onClick={() => select(index)}>
                {c.label}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
          <span className="text-[11px] text-muted-foreground">{client.hint}</span>
          <pre className="m-0 whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{snippet}</pre>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// MCPError surfaces a server that couldn't start (e.g. the fixed port is already
// in use). It reuses the plug icon so the footer keeps the same shape, tinted red
// to signal the failure, instead of silently dropping the connection command.
function MCPError({ message }: { message: string }) {
  return <IconButton size="xs" variant="ghost" tooltip={false} icon={Plug} aria-label={message} className={cn(statusBarIconClass, "text-destructive")} />;
}

function openFeedback() {
  const url = "https://github.com/wham/kaja/issues/new?template=feedback.yml";
  if (isWailsEnvironment()) {
    BrowserOpenURL(url);
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
      BrowserOpenURL(githubUrl);
    }
  };

  // The left cluster is whatever this build has to say about itself, separated by
  // rules. The compile status sits at the end so its label can grow and shrink
  // without moving the ref and the build around.
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
  return (
    <div className="flex h-[30px] shrink-0 items-center border-t border-border bg-chrome pl-3 pr-[11px]">
      <div className="flex items-center gap-2">
        {leftItems.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <div className="h-3 w-px bg-border" />}
            {item}
          </Fragment>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3">
        {mcpInfo?.enabled && mcpInfo.url && <MCPStatus info={mcpInfo} active={mcpActive} />}
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
