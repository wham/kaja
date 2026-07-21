import * as React from "react";

import { cn } from "../cn";

// Stand-in for Primer's SegmentedControl: a horizontal group of buttons where
// one is selected. Matches the <SegmentedControl><SegmentedControl.Button
// selected onClick> compound API.
interface SegmentedControlProps extends React.HTMLAttributes<HTMLDivElement> {
  "aria-label"?: string;
}

function SegmentedControl({ className, children, ...props }: SegmentedControlProps) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5", className)} {...props}>
      {children}
    </div>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  leadingIcon?: React.ComponentType<{ size?: number }>;
}

function Button({ selected, leadingIcon: LeadingIcon, className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {LeadingIcon && <LeadingIcon size={16} />}
      {children}
    </button>
  );
}

SegmentedControl.Button = Button;

export { SegmentedControl };
