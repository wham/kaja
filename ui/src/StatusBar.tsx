import { IconButton } from "@primer/react";
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
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: 12,
        background: "var(--bgColor-default)",
        borderTop: "1px solid var(--borderColor-default)",
        flexShrink: 0,
      }}
    >
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
