import { useId } from "react";
import { cn } from "./cn";

/**
 * The Kaja mark, at the sizes the chrome can carry it.
 *
 * The mark is a trace — a line that dips, spikes and settles — which is
 * literally what a run is. So it is the running indicator: while a run is in
 * flight the line draws itself left to right, and the moment the run lands the
 * mark goes and the run's status dot comes back. It is doing the job it looks
 * like it does, and it is the only thing in the chrome that moves.
 */

// The mark's own geometry, one unit inside its box so a round cap never clips.
const TRACE_PATH = "M2 18 H11 L17 4 L26 24 L31 14 H46";
const TRACE_VIEW_BOX = "0 0 48 26";
// Longer than the path itself (≈72 units), so one cycle is the line arriving
// once rather than a second dash chasing the first across it.
const TRACE_DASH = 90;

interface KajaTraceProps {
  width?: number;
  height?: number;
  // Whether the line draws itself. At rest it is just the mark.
  running?: boolean;
  strokeWidth?: number;
  className?: string;
}

export function KajaTrace({ width = 20, height = 12, running = false, strokeWidth = 4, className }: KajaTraceProps) {
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
      aria-label={running ? "Running" : "Kaja"}
      data-testid="kaja-trace"
      className={cn("shrink-0", className)}
    >
      <path
        d={TRACE_PATH}
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={running ? "animate-trace" : undefined}
        strokeDasharray={running ? TRACE_DASH : undefined}
        strokeDashoffset={running ? TRACE_DASH : undefined}
      />
      <defs>
        <linearGradient id={gradientId} x1="2" y1="0" x2="46" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-rust)" />
          <stop offset="1" stopColor="var(--brand-violet)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
