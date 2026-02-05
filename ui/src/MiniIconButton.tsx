import type { Icon } from "@primer/octicons-react";

interface MiniIconButtonProps {
  icon: Icon;
  "aria-label": string;
  onClick?: () => void;
}

export function MiniIconButton({ icon: Icon, "aria-label": ariaLabel, onClick }: MiniIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        padding: 0,
        border: "none",
        borderRadius: 0,
        background: "transparent",
        color: "var(--fgColor-muted)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bgColor-muted)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={14} />
    </button>
  );
}
