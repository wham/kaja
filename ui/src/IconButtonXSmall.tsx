import type { Icon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";

interface IconButtonXSmallProps {
  icon: Icon;
  "aria-label": string;
  onClick?: () => void;
  rounded?: boolean;
}

export function IconButtonXSmall({ icon, "aria-label": ariaLabel, onClick, rounded }: IconButtonXSmallProps) {
  return (
    <IconButton
      icon={icon}
      aria-label={ariaLabel}
      onClick={onClick}
      size="small"
      variant="invisible"
      className="IconButtonXSmall"
      style={{
        width: 22,
        height: 20,
        padding: 0,
        borderRadius: rounded ? 4 : 0,
        color: "var(--fgColor-muted)",
      }}
    />
  );
}
