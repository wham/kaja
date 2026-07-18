import { Popover as BasePopover } from "@base-ui-components/react/popover";
import * as React from "react";

import { cn } from "../../lib/utils";

const Popover = BasePopover.Root;

function PopoverTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) {
    return <BasePopover.Trigger render={children as React.ReactElement<Record<string, unknown>>} {...props} />;
  }
  return <BasePopover.Trigger {...props}>{children}</BasePopover.Trigger>;
}

interface PopoverContentProps extends React.ComponentPropsWithoutRef<typeof BasePopover.Popup> {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

function PopoverContent({ className, align = "center", side = "bottom", sideOffset = 4, children, ...props }: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className="z-50 outline-none" align={align} side={side} sideOffset={sideOffset}>
        <BasePopover.Popup
          className={cn(
            "origin-[var(--transform-origin)] rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
