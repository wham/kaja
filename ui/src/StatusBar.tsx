import { MarkGithubIcon, MoonIcon, SunIcon } from "@primer/octicons-react";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL } from "./wailsjs/runtime/runtime";
import { IconButtonXSmall } from "./IconButtonXSmall";

export type ColorMode = "day" | "night";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
}

export function StatusBar({ colorMode, onToggleColorMode, gitRef }: StatusBarProps) {
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
        borderTop: "1px solid var(--borderColor-default)",
        flexShrink: 0,
      }}
    >
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
      <IconButtonXSmall
        icon={colorMode === "night" ? SunIcon : MoonIcon}
        aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleColorMode}
      />
    </div>
  );
}
