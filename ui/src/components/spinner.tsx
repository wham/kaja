import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../cn";

const spinnerVariants = cva("animate-spin text-muted-foreground", {
  variants: {
    size: {
      sm: "size-4",
      default: "size-8",
      lg: "size-12",
    },
  },
  defaultVariants: { size: "default" },
});

export interface SpinnerProps extends Omit<React.SVGProps<SVGSVGElement>, "size">, VariantProps<typeof spinnerVariants> {}

export function Spinner({ size, className, ...props }: SpinnerProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn(spinnerVariants({ size }), className)} {...props}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M15 8a7 7 0 0 1-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
