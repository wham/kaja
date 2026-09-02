import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn, cva, type VariantProps } from "../cn";
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
  // Which tooltip the button carries, and it is never two: "hover" is the framework
  // one; "native" is the title attribute, which is what a Base UI trigger (Popover,
  // DropdownMenu) takes because both would claim the same `render` slot; "none" is for
  // a button something around it already wraps in a tooltip of its own.
  tooltip?: "hover" | "native" | "none";
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, "aria-label": ariaLabel, variant = "outline", size, tooltip = "hover", className, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      title={tooltip === "native" ? ariaLabel : undefined}
      className={cn(buttonVariants({ variant, size: "icon" }), iconButtonVariants({ size }), className)}
      {...rest}
    >
      <Icon />
    </button>
  );
  if (tooltip !== "hover") return button;
  return <SimpleTooltip text={ariaLabel}>{button}</SimpleTooltip>;
});

export { IconButton };
