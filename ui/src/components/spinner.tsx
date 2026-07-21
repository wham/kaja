import * as React from "react";

import { cn } from "../cn";

const sizePx: Record<string, number> = { small: 16, medium: 32, large: 48 };

export interface SpinnerProps extends Omit<React.SVGProps<SVGSVGElement>, "size"> {
  size?: "small" | "medium" | "large" | number;
}

export function Spinner({ size = "medium", className, ...props }: SpinnerProps) {
  const px = typeof size === "number" ? size : sizePx[size];
  return (
    <svg width={px} height={px} viewBox="0 0 16 16" fill="none" className={cn("animate-spin text-muted-foreground", className)} {...props}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M15 8a7 7 0 0 1-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
