import type { Icon } from "@primer/octicons-react";

interface IconButtonXSmallProps {
  icon: Icon;
  "aria-label": string;
  onClick?: () => void;
  rounded?: boolean;
}

export function IconButtonXSmall({ icon: Icon, "aria-label": ariaLabel, onClick, rounded }: IconButtonXSmallProps) {
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
        height: 20,
        padding: 0,
        border: "none",
        borderRadius: rounded ? 4 : 0,
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
