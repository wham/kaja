import { Tooltip } from "@base-ui-components/react/tooltip";
import * as React from "react";
import { cn } from "../cn";

export interface SimpleTooltipProps {
  text: string;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  contentClassName?: string;
}

function SimpleTooltip({ text, children, side = "top", delayDuration = 300, contentClassName }: SimpleTooltipProps) {
  return (
    <Tooltip.Provider delay={delayDuration}>
      <Tooltip.Root>
        <Tooltip.Trigger render={children as React.ReactElement<Record<string, unknown>>} />
        <Tooltip.Portal>
          <Tooltip.Positioner side={side} sideOffset={4} className="z-50">
            <Tooltip.Popup
              className={cn(
                "rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
                contentClassName,
              )}
            >
              {text}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export { SimpleTooltip };
