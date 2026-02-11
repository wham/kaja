import { MarkGithubIcon, MoonIcon, SunIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { isWailsEnvironment } from "./wails";
import { BrowserOpenURL } from "./wailsjs/runtime/runtime";
import { CheckForUpdate } from "./wailsjs/go/main/App";
import { IconButtonXSmall } from "./IconButtonXSmall";

export type ColorMode = "day" | "night";

interface UpdateInfo {
  available: boolean;
  latestVersion: string;
  downloadUrl: string;
}

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
  gitRef?: string;
}

export function StatusBar({ colorMode, onToggleColorMode, gitRef }: StatusBarProps) {
  const shortRef = gitRef ? (gitRef.length > 7 ? gitRef.slice(0, 7) : gitRef) : undefined;
  const githubUrl = gitRef ? `https://github.com/wham/kaja/tree/${gitRef}` : undefined;

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({
    available: false,
    latestVersion: "",
    downloadUrl: "",
  });

  // Auto-check for updates on startup (only in desktop/Wails environment)
  useEffect(() => {
    if (!isWailsEnvironment() || !gitRef) return;

    const timeoutId = setTimeout(async () => {
      try {
        const result = await CheckForUpdate();
        setUpdateInfo({
          available: result.updateAvailable,
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
        });
      } catch {
        // Silently ignore update check errors on startup
      }
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [gitRef]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isWailsEnvironment() && githubUrl) {
      e.preventDefault();
      BrowserOpenURL(githubUrl);
    }
  };

  const handleDownloadClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isWailsEnvironment() && updateInfo.downloadUrl) {
      e.preventDefault();
      BrowserOpenURL(updateInfo.downloadUrl);
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
          updateInfo.available && updateInfo.latestVersion ? (
            <a
              href={updateInfo.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDownloadClick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--fgColor-accent)",
                textDecoration: "none",
              }}
            >
              <MarkGithubIcon size={12} />
              <span style={{ position: "relative", top: 1 }}>
                {shortRef} → {updateInfo.latestVersion}
              </span>
            </a>
          ) : (
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
          )
        ) : (
          <div />
        )}
      </div>
      <IconButtonXSmall
        icon={colorMode === "night" ? SunIcon : MoonIcon}
        aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleColorMode}
      />
    </div>
  );
}
