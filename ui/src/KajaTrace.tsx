import { useId } from "react";
import { cn } from "./cn";

/**
 * The Kaja mark, at the size the chrome can carry it.
 */

// The mark's own geometry, one unit inside its box so a round cap never clips.
const TRACE_PATH = "M2 18 H11 L17 4 L26 24 L31 14 H46";
const TRACE_VIEW_BOX = "0 0 48 26";

interface KajaTraceProps {
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

export function KajaTrace({ width = 16, height = 10, strokeWidth = 4.5, className }: KajaTraceProps) {
  // Two of these on screen would otherwise share one gradient and the second
  // would win.
  const gradientId = useId();

  return (
    <svg
      width={width}
      height={height}
      viewBox={TRACE_VIEW_BOX}
      fill="none"
      role="img"
      aria-label="Kaja"
      data-testid="kaja-trace"
      className={cn("shrink-0", className)}
    >
      <path d={TRACE_PATH} stroke={`url(#${gradientId})`} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id={gradientId} x1="2" y1="0" x2="46" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-rust)" />
          <stop offset="1" stopColor="var(--brand-violet)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
