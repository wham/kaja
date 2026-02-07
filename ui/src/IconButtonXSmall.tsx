import type { Icon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";

interface IconButtonXSmallProps extends React.ComponentPropsWithoutRef<"button"> {
  icon: Icon;
  "aria-label": string;
  rounded?: boolean;
}

export const IconButtonXSmall = React.forwardRef<HTMLButtonElement, IconButtonXSmallProps>(
  function IconButtonXSmall({ icon, "aria-label": ariaLabel, onClick, rounded, ...rest }, ref) {
    return (
      <IconButton
        ref={ref}
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
        {...rest}
      />
    );
  },
);
