import { useState } from "react";
import { MarkGithubIcon, MoonIcon, SunIcon, PlugIcon } from "@primer/octicons-react";
import { AnchoredOverlay, Button, SegmentedControl } from "@primer/react";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL } from "./wailsjs/runtime/runtime";
import { IconButtonXSmall } from "./IconButtonXSmall";
import { FeaturePreview, FeaturePreviews } from "./FeaturePreviews";
import { main } from "./wailsjs/go/models";

export type ColorMode = "day" | "night";

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
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      renderAnchor={(anchorProps) => <IconButtonXSmall icon={PlugIcon} aria-label="MCP server" {...anchorProps} />}
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fgColor-default)" }}>MCP server</span>
        <SegmentedControl aria-label="MCP client" size="small">
          {mcpClients.map((c, index) => (
            <SegmentedControl.Button key={c.label} selected={index === selected} onClick={() => select(index)}>
              {c.label}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        <span style={{ fontSize: 11, color: "var(--fgColor-muted)" }}>{client.hint}</span>
        <pre
          style={{
            fontSize: 11,
            padding: 8,
            margin: 0,
            background: "var(--bgColor-muted)",
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontFamily: "var(--fontStack-monospace, monospace)",
            color: "var(--fgColor-default)",
          }}
        >
          {snippet}
        </pre>
        <Button size="small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </AnchoredOverlay>
  );
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
    <div
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 16,
        paddingRight: 16,
        background: "var(--bgColor-default)",
        borderTop: "1px solid var(--borderColor-muted)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {githubUrl && shortRef ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--fgColor-muted)",
              textDecoration: "none",
            }}
          >
            <MarkGithubIcon size={12} />
            <span style={{ position: "relative", top: 1 }}>{shortRef}</span>
          </a>
        ) : (
          <div />
        )}
        {buildNumber && <span style={{ fontSize: 11, color: "var(--fgColor-muted)" }}>build {buildNumber}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        {mcpInfo?.enabled && mcpInfo.url && <MCPStatus info={mcpInfo} />}
        <FeaturePreviews features={featurePreviews} onToggle={onToggleFeaturePreview} />
        <IconButtonXSmall
          icon={colorMode === "night" ? SunIcon : MoonIcon}
          aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onToggleColorMode}
        />
      </div>
    </div>
  );
}
