import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "../../lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  ),
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Convenience wrapper matching Primer's <Tooltip text="..."> single-child API.
export interface SimpleTooltipProps {
  text: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

function SimpleTooltip({ text, children, side = "top", delayDuration = 300 }: SimpleTooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SimpleTooltip };
