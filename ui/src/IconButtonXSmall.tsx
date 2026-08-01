import React from "react";

import type { Icon } from "./components/icons";
import { cn } from "./cn";

interface IconButtonXSmallProps extends React.ComponentPropsWithoutRef<"button"> {
  icon: Icon;
  "aria-label": string;
  rounded?: boolean;
}

export const IconButtonXSmall = React.forwardRef<HTMLButtonElement, IconButtonXSmallProps>(function IconButtonXSmall(
  { icon: IconCmp, "aria-label": ariaLabel, onClick, rounded, style, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      style={{ width: 22, height: 20, borderRadius: rounded ? 4 : 0, ...style }}
      {...rest}
    >
      <IconCmp size={16} />
    </button>
  );
});
