import { useState } from "react";
import { Moon, Sun, Plug } from "lucide-react";
import { Button } from "./components/button";
import { IconButton } from "./components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { SegmentedControl } from "./components/segmented-control";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL } from "./wailsjs/runtime/runtime";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { main } from "./wailsjs/go/models";

export type ColorMode = "day" | "night";

// lucide ships no brand icons, so the GitHub mark is drawn here.
function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
  buildNumber?: string;
  featurePreviews: FeaturePreview[];
  onToggleFeaturePreview: (key: string) => void;
  mcpInfo?: main.MCPInfo;
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
function MCPStatus({ info }: { info: main.MCPInfo }) {
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
      <PopoverTrigger asChild>
        <IconButton size="xs" variant="ghost" tooltip={false} icon={Plug} aria-label="MCP server" />
      </PopoverTrigger>
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
          <pre className="m-0 whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">
            {snippet}
          </pre>
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
  return <IconButton size="xs" variant="ghost" tooltip={false} icon={Plug} aria-label={message} className="text-destructive" />;
}

export function StatusBar({ colorMode, onToggleColorMode, gitRef, buildNumber, featurePreviews, onToggleFeaturePreview, mcpInfo }: StatusBarProps) {
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const githubUrl = gitRef ? `https://github.com/wham/kaja/tree/${gitRef}` : undefined;

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isWailsEnvironment() && githubUrl) {
      e.preventDefault();
      BrowserOpenURL(githubUrl);
    }
  };

  return (
    <div className="flex h-[22px] shrink-0 items-center justify-between border-t border-border bg-background px-4">
      <div className="flex items-center gap-1.5">
        {githubUrl && shortRef ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground no-underline"
          >
            <GithubIcon size={12} />
            <span className="relative top-px">{shortRef}</span>
          </a>
        ) : (
          <div />
        )}
        {buildNumber && <span className="text-[11px] text-muted-foreground">build {buildNumber}</span>}
      </div>
      <div className="flex items-center gap-0.5">
        {mcpInfo?.enabled && mcpInfo.url && <MCPStatus info={mcpInfo} />}
        {mcpInfo?.error && <MCPError message={mcpInfo.error} />}
        <FeaturePreviews features={featurePreviews} onToggle={onToggleFeaturePreview} />
        <IconButton
          size="xs"
          variant="ghost"
          tooltip={false}
          icon={colorMode === "night" ? Sun : Moon}
          aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleColorMode}
        />
      </div>
    </div>
  );
}
