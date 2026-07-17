import * as React from "react";

import { cn } from "../../lib/utils";
import type { Icon } from "../icons";
import { buttonVariants } from "./button";
import { SimpleTooltip } from "./tooltip";

type IconButtonVariant = "default" | "invisible" | "primary" | "danger";
type IconButtonSize = "small" | "medium" | "large";

const variantMap: Record<IconButtonVariant, "outline" | "ghost" | "default" | "destructive"> = {
  default: "outline",
  invisible: "ghost",
  primary: "default",
  danger: "destructive",
};

const sizeClass: Record<IconButtonSize, string> = {
  small: "h-7 w-7",
  medium: "h-8 w-8",
  large: "h-10 w-10",
};

const iconPx: Record<IconButtonSize, number> = { small: 16, medium: 16, large: 20 };

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: Icon;
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  tooltip?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: IconCmp, "aria-label": ariaLabel, variant = "default", size = "medium", tooltip = true, className, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      className={cn(buttonVariants({ variant: variantMap[variant], size: "icon" }), sizeClass[size], className)}
      {...rest}
    >
      <IconCmp size={iconPx[size]} />
    </button>
  );
  if (!tooltip) return button;
  return (
    <SimpleTooltip text={ariaLabel}>{button}</SimpleTooltip>
  );
});

export { IconButton };
