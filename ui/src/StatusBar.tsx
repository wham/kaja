import { IconButton } from "@primer/react";
import { MarkGithubIcon, MoonIcon, SunIcon } from "@primer/octicons-react";

export type ColorMode = "day" | "night";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
}

export function StatusBar({ colorMode, onToggleColorMode, gitRef }: StatusBarProps) {
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const githubUrl = gitRef ? `https://github.com/wham/kaja/tree/${gitRef}` : undefined;

  return (
    <div
      style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 12,
        paddingRight: 20,
        background: "var(--bgColor-default)",
        borderTop: "1px solid var(--borderColor-default)",
        flexShrink: 0,
      }}
    >
      <div>
        {githubUrl && shortRef && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--fgColor-muted)",
              textDecoration: "none",
            }}
          >
            <MarkGithubIcon size={16} />
            {shortRef}
          </a>
        )}
      </div>
      <IconButton
        icon={colorMode === "night" ? SunIcon : MoonIcon}
        size="small"
        variant="invisible"
        aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleColorMode}
      />
    </div>
  );
}
