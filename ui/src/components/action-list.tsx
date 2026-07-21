import * as React from "react";

import { cn } from "../lib/utils";

// Stand-in for Primer's standalone ActionList (used as a selectable list, not a
// dropdown menu). Item lays its children out with flex-wrap so a block
// Description drops onto its own full-width line beneath the label.
function ActionList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ul role="list" className={cn("flex flex-col gap-0.5", className)}>
      {children}
    </ul>
  );
}

interface ItemProps {
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  variant?: "default" | "danger";
  className?: string;
  children: React.ReactNode;
}

const Item = React.forwardRef<HTMLLIElement, ItemProps>(({ onSelect, active, disabled, variant = "default", className, children }, ref) => (
  <li
    ref={ref}
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-selected={active}
    aria-disabled={disabled}
    onClick={disabled ? undefined : onSelect}
    onKeyDown={(e) => {
      if (disabled) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect?.();
      }
    }}
    className={cn(
      "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
      disabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent",
      active && "bg-accent text-accent-foreground",
      variant === "danger" && "text-destructive",
      className,
    )}
  >
    {children}
  </li>
));
Item.displayName = "ActionList.Item";

function LeadingVisual({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center text-muted-foreground">{children}</span>;
}

function TrailingVisual({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto inline-flex items-center text-muted-foreground">{children}</span>;
}

function Description({ variant = "inline", children }: { variant?: "inline" | "block"; children: React.ReactNode }) {
  return <span className={cn("text-xs text-muted-foreground", variant === "block" && "basis-full")}>{children}</span>;
}

ActionList.Item = Item;
ActionList.LeadingVisual = LeadingVisual;
ActionList.TrailingVisual = TrailingVisual;
ActionList.Description = Description;

export { ActionList };
