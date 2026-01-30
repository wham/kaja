import { MoonIcon, SunIcon } from "@primer/octicons-react";

export type ColorMode = "day" | "night";

interface StatusBarProps {
  colorMode: ColorMode;
  onToggleColorMode: () => void;
}

export function StatusBar({ colorMode, onToggleColorMode }: StatusBarProps) {
  return (
    <div
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: 24,
        background: "var(--bgColor-default)",
        borderTop: "1px solid var(--borderColor-default)",
        flexShrink: 0,
      }}
    >
      <button
        aria-label={colorMode === "night" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleColorMode}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--fgColor-muted)",
          display: "flex",
          alignItems: "center",
        }}
      >
        {colorMode === "night" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      </button>
    </div>
  );
}
