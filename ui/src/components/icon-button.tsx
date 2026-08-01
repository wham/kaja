import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../cn";
import { buttonVariants } from "./button";
import { SimpleTooltip } from "./tooltip";

const iconButtonVariants = cva("", {
  variants: {
    size: {
      xs: "h-5 w-[22px] rounded text-muted-foreground [&_svg]:size-4",
      sm: "h-7 w-7 [&_svg]:size-4",
      default: "h-8 w-8 [&_svg]:size-4",
      lg: "h-10 w-10 [&_svg]:size-5",
    },
  },
  defaultVariants: { size: "default" },
});

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants>, Pick<VariantProps<typeof buttonVariants>, "variant"> {
  icon: LucideIcon;
  "aria-label": string;
  // Hover tooltip. Turn off when the button is a Base UI trigger (Popover,
  // DropdownMenu): both would claim the same `render` slot, so the native
  // title attribute stands in.
  tooltip?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, "aria-label": ariaLabel, variant = "outline", size, tooltip = true, className, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      title={tooltip ? undefined : ariaLabel}
      className={cn(buttonVariants({ variant, size: "icon" }), iconButtonVariants({ size }), className)}
      {...rest}
    >
      <Icon />
    </button>
  );
  if (!tooltip) return button;
  return <SimpleTooltip text={ariaLabel}>{button}</SimpleTooltip>;
});

export { IconButton };
