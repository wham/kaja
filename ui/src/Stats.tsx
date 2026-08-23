import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { callDurationMs } from "./kaja";
import { cn } from "./cn";
import { PerfPhase, PerfSchedule } from "./perfTest";
import { RunGroup } from "./runs";
import { MethodRow, RunStats, StatsSlot } from "./runStats";
import {
  bandPoints,
  barsFor,
  CHART_WIDTH,
  failurePositions,
  formatErrorRate,
  formatMs,
  formatMsBare,
  formatRps,
  linePoints,
  niceCeiling,
  slotsFor,
  stepPoints,
  timeTicks,
} from "./statsChart";

/**
 * What a run's calls add up to. The third view of one run: the log is every call in
 * wall order, the canvas is what the script drew, and this is the shape of the whole
 * of it — percentiles, throughput, concurrency and a breakdown per method.
 *
 * Nothing here is specific to a perf test. Everything is computed from what a call
 * already records, so a paging loop has latency and throughput like anything else.
 */

const LATENCY_HEIGHT = 104;
const RPS_HEIGHT = 52;
const IN_FLIGHT_HEIGHT = 36;
const DISTRIBUTION_HEIGHT = 56;
// A serial loop must not read as a saturated one, so the concurrency axis has a floor
// rather than being the run's own maximum.
const MIN_IN_FLIGHT_CEILING = 4;
// A bucket with one failure in three hundred calls still has to be a mark you can see.
const MIN_FAILURE_SEGMENT = 2;

interface StatsProps {
  group: RunGroup;
  // Opens a call in the log, which is where the page hands off whenever it names one.
  onSelectCall: (itemId: string) => void;
}

export function Stats({ group, onSelectCall }: StatsProps) {
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const slots = slotsFor(width);
  const bars = barsFor(width);
  const stats = useMemo(
    () => group.metrics.view(slots, bars, group.run.durationMs),
    // The metrics are a buffer rather than React state, so its own version is what
    // says a chart would draw differently — walking the run to find out is the thing
    // this whole module exists not to do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group.metrics, group.metrics.version, slots, bars, group.run.durationMs],
  );

  if (stats.calls === 0) {
    return (
      <div ref={body} className="flex min-h-0 flex-1 items-start bg-background px-3 py-3">
        <span className="text-xs text-muted-foreground">This run made no calls.</span>
      </div>
    );
  }

  // One call has no distribution, no throughput and no concurrency — it has a
  // duration and an outcome, and the table is the rest of what there is to say.
  const single = stats.calls === 1;
  const schedule = group.run.perf;
  const bands = schedule === undefined ? [] : phaseBands(schedule.phases, group.run.startedAt, stats.spanMs, group.run.startedAt + stats.spanMs);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <Stats.Tiles group={group} stats={stats} single={single} />
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
        {!single && (
          <>
            <Stats.Latency stats={stats} bands={bands} />
            <Stats.Throughput stats={stats} bands={bands} />
            <Stats.InFlight stats={stats} bands={bands} />
            <Stats.Distribution stats={stats} />
          </>
        )}
        <Stats.Methods stats={stats} onSelectCall={onSelectCall} />
      </div>
    </div>
  );
}

/**
 * One row of borderless cells divided by hairlines, not cards — the same weight as
 * the tail bar. It is the only thing on the page that is pinned, so the charts, the
 * distribution and the table scroll under it as one column and a console dragged open
 * is the same page it was at 300px.
 */
Stats.Tiles = function ({ group, stats, single }: { group: RunGroup; stats: RunStats; single: boolean }) {
  const only = single ? group.calls[0] : undefined;
  const cells: TileCell[] = only
    ? [
        { label: "duration", value: formatMs(callDurationMs(only.call!) ?? undefined) },
        {
          label: "outcome",
          value: only.call?.error !== undefined ? "failed" : "ok",
          className: only.call?.error !== undefined ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
        },
      ]
    : [
        { label: "requests", value: stats.calls.toLocaleString() },
        {
          label: "error rate",
          value: formatErrorRate(stats.errorRate, stats.failures),
          className: stats.failures > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
        },
        { label: "mean rps", value: formatRps(stats.meanRps) },
        { label: "p50", value: formatMs(stats.p50) },
        { label: "p95", value: formatMs(stats.p95) },
        { label: "p99", value: formatMs(stats.p99) },
      ];

  // The cell that closes the strip. A schedule states what it left out of the numbers
  // beside it; a run that is only a run has nothing to put there and says so by
  // leaving it empty rather than by ending the row early.
  return <StatTiles cells={cells} note={exclusionNote(stats)} />;
};

export interface TileCell {
  label: string;
  value: string;
  className?: string;
}

/**
 * One row of borderless cells divided by hairlines, not cards — the same weight as
 * the tail bar. Shared with the canvas's perf block, which is this strip and the way
 * to the rest of the page.
 */
export function StatTiles({ cells, note }: { cells: TileCell[]; note?: string }) {
  return (
    <div data-testid="stats-tiles" className="flex shrink-0 items-stretch overflow-hidden border-b border-border bg-card">
      {cells.map((cell, index) => (
        <div key={cell.label} className={cn("flex min-w-[96px] shrink flex-col justify-center px-3 py-2", index > 0 && "border-l border-border")}>
          <span className="truncate text-xs text-muted-foreground">{cell.label}</span>
          <span className={cn("truncate font-mono text-sm", cell.className ?? "text-foreground")}>{cell.value}</span>
        </div>
      ))}
      <div className="flex flex-1 items-center overflow-hidden border-l border-border px-3">
        {note !== undefined && <span className="truncate text-xs text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
}

/**
 * What the percentiles beside it are not of. A failed call's latency is the time it
 * took to be refused, which is not the number anyone reads a p99 for; a warm-up call
 * measured a cold server. Both are counted everywhere else, so the exclusion has to
 * be said rather than silently applied.
 */
export function exclusionNote(stats: { excludedWarmup: number; excludedFailures: number }): string | undefined {
  const parts: string[] = [];
  if (stats.excludedWarmup > 0) parts.push(`${stats.excludedWarmup.toLocaleString()} warm-up`);
  if (stats.excludedFailures > 0) parts.push(`${stats.excludedFailures.toLocaleString()} failed`);
  return parts.length === 0 ? undefined : `excl. ${parts.join(" · ")}`;
}

/** The header note: what the run was told to do. */
export function scheduleNote(schedule: PerfSchedule): string {
  const budget = schedule.iterations !== undefined ? `${schedule.iterations.toLocaleString()} iter` : formatScheduleSeconds(schedule.durationMs ?? 0);
  return `perf test · ${budget} · ${schedule.concurrency} vu`;
}

function formatScheduleSeconds(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 100 ? `${Number(seconds.toFixed(1))}s` : `${Math.round(seconds)}s`;
}

// A tint per phase, and none for the plateau: the bands exist to show where the
// schedule was doing something other than holding still.
const PHASE_TINT: { [name: string]: string } = {
  "warm-up": "bg-foreground/[0.06]",
  "ramp-up": "bg-foreground/[0.03]",
  "ramp-down": "bg-foreground/[0.03]",
  steady: "",
};

/**
 * The schedule, drawn behind the charts. The only perf-test-specific ink on the page,
 * and the only background tint on it — a plain run has none and loses nothing else.
 *
 * The same bands go behind all three charts so they read as one ruler; only the tall
 * one has the room to name them.
 */
Stats.PhaseBands = function ({ bands, labels }: { bands: PhaseBand[]; labels?: boolean }) {
  if (bands.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bands.map((band) => (
        <div
          key={`${band.name}-${band.left}`}
          className={cn("absolute inset-y-0", PHASE_TINT[band.name] ?? "")}
          style={{ left: `${band.left}%`, width: `${band.width}%` }}
        >
          {labels && <span className="absolute left-1.5 top-1 whitespace-nowrap text-[9px] text-muted-foreground">{band.name}</span>}
        </div>
      ))}
    </div>
  );
};

export interface PhaseBand {
  name: string;
  left: number;
  width: number;
}

/**
 * The phases as percentages of the chart's own axis. The schedule is in epoch
 * milliseconds and the axis starts at the run, which began before the test did — a
 * script that fetched its fixtures first has a stretch of chart before the bands.
 */
export function phaseBands(phases: PerfPhase[], runStartedAt: number, spanMs: number, endedAt: number): PhaseBand[] {
  if (spanMs <= 0) return [];
  const bands: PhaseBand[] = [];
  for (const phase of phases) {
    const from = ((phase.startedAt - runStartedAt) / spanMs) * 100;
    const to = (((phase.endedAt ?? endedAt) - runStartedAt) / spanMs) * 100;
    const left = Math.max(0, Math.min(100, from));
    const width = Math.max(0, Math.min(100, to) - left);
    if (width > 0) bands.push({ name: phase.name, left, width });
  }
  return bands;
}

/**
 * p50 with the p50–p95 and p95–p99 envelopes behind it. Three bands rather than three
 * lines: the tail is a region the run spent time in, and drawing it as a line invites
 * reading a p99 spike as one call's story.
 */
Stats.Latency = function ({ stats, bands }: { stats: RunStats; bands: PhaseBand[] }) {
  const ceiling = niceCeiling(Math.max(...stats.slots.map((slot) => slot.p99 ?? 0), 0));
  const tail = bandPoints(
    stats.slots,
    (slot) => slot.p95,
    (slot) => slot.p99,
    ceiling,
    LATENCY_HEIGHT,
  );
  const body = bandPoints(
    stats.slots,
    (slot) => slot.p50,
    (slot) => slot.p95,
    ceiling,
    LATENCY_HEIGHT,
  );
  const median = linePoints(stats.slots, (slot) => slot.p50, ceiling, LATENCY_HEIGHT);

  return (
    <div className="px-3 pt-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Latency</span>
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="font-mono text-xs text-muted-foreground">p50</span>
          <span className="font-mono text-xs text-muted-foreground opacity-75">p50–p95</span>
          <span className="font-mono text-xs text-muted-foreground opacity-55">p95–p99</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatMs(ceiling)}</span>
        </div>
      </div>
      <div data-testid="stats-latency" className="relative rounded border border-border" style={{ height: LATENCY_HEIGHT }}>
        {/* The only chart with the room to name them, so it is the one that does. */}
        <Stats.PhaseBands bands={bands} labels />
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${LATENCY_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-foreground"
          aria-hidden="true"
        >
          {tail && <polygon points={tail} fill="currentColor" opacity={0.1} />}
          {body && <polygon points={body} fill="currentColor" opacity={0.2} />}
          {median && <polyline points={median} fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.85} vectorEffect="non-scaling-stroke" />}
        </svg>
        <Stats.FailureMarks stats={stats} />
      </div>
    </div>
  );
};

/** Where the run failed, along the same clock — the first of the three places it says so. */
Stats.FailureMarks = function ({ stats }: { stats: RunStats }) {
  const marks = failurePositions(stats.slots);
  if (marks.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[5px]">
      {marks.map((mark) => (
        <span
          key={mark.position}
          data-testid="stats-failure-mark"
          className="absolute bottom-0 h-[5px] w-[2px] bg-destructive"
          style={{ left: `${mark.position * 100}%` }}
        />
      ))}
    </div>
  );
};

Stats.Throughput = function ({ stats, bands }: { stats: RunStats; bands: PhaseBand[] }) {
  const ceiling = niceCeiling(stats.peakRps);
  return (
    <div className="px-3 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Requests / s</span>
        <span className="font-mono text-xs text-muted-foreground">peak {formatRps(stats.peakRps)}</span>
      </div>
      <div data-testid="stats-throughput" className="relative mt-1 flex items-end gap-0.5 rounded border border-border px-1" style={{ height: RPS_HEIGHT }}>
        <Stats.PhaseBands bands={bands} />
        {stats.slots.map((slot, index) => (
          <Stats.Bar key={index} slot={slot} ceiling={ceiling} height={RPS_HEIGHT} />
        ))}
      </div>
    </div>
  );
};

/**
 * One slice of throughput, with the share of it that failed in red at the foot. A
 * failure is a fraction of a bar and would round to nothing on its own, so the
 * segment has a floor: what it says is "some", and the count is in the table.
 */
Stats.Bar = function ({ slot, ceiling, height }: { slot: StatsSlot; ceiling: number; height: number }) {
  const full = Math.min(1, slot.rps / ceiling) * height;
  const failed = slot.failures === 0 ? 0 : Math.max(MIN_FAILURE_SEGMENT, (slot.failures / slot.calls) * full);
  const label = `${slot.calls} ${slot.calls === 1 ? "call" : "calls"} · ${formatRps(slot.rps)} rps${slot.failures > 0 ? ` · ${slot.failures} failed` : ""}`;
  return (
    <span className="flex flex-1 flex-col justify-end" style={{ height }} title={label}>
      <span className="w-full bg-muted" style={{ height: Math.max(0, full - failed) }} />
      {failed > 0 && <span className="w-full bg-destructive" style={{ height: failed }} />}
    </span>
  );
};

/**
 * How many calls were in the air, as a step: the number holds until something changes
 * it. Flatlining at one is the honest reading of a serial loop and explains a low rps
 * better than the throughput chart does.
 */
Stats.InFlight = function ({ stats, bands }: { stats: RunStats; bands: PhaseBand[] }) {
  const ceiling = Math.max(MIN_IN_FLIGHT_CEILING, stats.maxInFlight);
  const ticks = timeTicks(stats.spanMs);
  return (
    <div className="px-3 pt-3">
      <span className="text-xs text-muted-foreground">In flight</span>
      <div data-testid="stats-in-flight" className="relative mt-1 rounded border border-border" style={{ height: IN_FLIGHT_HEIGHT }}>
        <Stats.PhaseBands bands={bands} />
        <svg viewBox={`0 0 ${CHART_WIDTH} ${IN_FLIGHT_HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <polyline
            points={stepPoints(stats.slots, ceiling, IN_FLIGHT_HEIGHT)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            className="text-muted-foreground"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="absolute right-1.5 top-1 font-mono text-[9px] text-muted-foreground">max {stats.maxInFlight}</span>
      </div>
      {/* The one axis the three charts share, stated once under all of them. */}
      <div className="relative h-[16px] pt-1 pb-2">
        {ticks.map((tick) => (
          <span
            key={tick.position}
            className="absolute top-1 font-mono text-[10px] text-muted-foreground"
            style={tick.position === 0 ? { left: 0 } : tick.position === 1 ? { right: 0 } : { left: `${tick.position * 100}%`, transform: "translateX(-50%)" }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * Where the run's calls actually landed, on a log axis — a long tail reads as a tail
 * rather than as one bar at the far left and nothing else. The percentiles sit on it
 * as the three lines they are.
 */
Stats.Distribution = function ({ stats }: { stats: RunStats }) {
  if (stats.distribution.length === 0) return null;
  const tallest = Math.max(...stats.distribution.map((bar) => bar.calls), 1);
  return (
    <div className="border-t border-border px-3 pt-2">
      <span className="text-xs text-muted-foreground">Distribution</span>
      <div data-testid="stats-distribution" className="relative mt-1 flex items-end gap-0.5" style={{ height: DISTRIBUTION_HEIGHT }}>
        {stats.distribution.map((bar) => (
          <span
            key={bar.position}
            className="flex-1 bg-muted"
            style={{ height: `${Math.max(bar.calls > 0 ? 2 : 0, (bar.calls / tallest) * 100)}%` }}
            title={`${formatMs(bar.fromMs)} – ${formatMs(bar.toMs)} · ${bar.calls.toLocaleString()} ${bar.calls === 1 ? "call" : "calls"}`}
          />
        ))}
        {stats.markers.map((marker) => (
          <span key={marker.label} className="absolute inset-y-0 border-l border-border" style={{ left: `${marker.position * 100}%` }} />
        ))}
      </div>
      <div className="relative h-[16px] pt-1 pb-2">
        {stats.markers.map((marker) => (
          <span
            key={marker.label}
            className="absolute top-1 font-mono text-[9px] text-muted-foreground"
            style={{ left: `${marker.position * 100}%`, transform: marker.position > 0.9 ? "translateX(-100%)" : undefined }}
            title={formatMs(marker.valueMs)}
          >
            {marker.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const COLUMN = "w-[56px] shrink-0 text-right";

/**
 * The breakdown per method, and the one call worth naming. One method and one row is
 * fine — the table is where a run with no shape to it earns the page.
 */
Stats.Methods = function ({ stats, onSelectCall }: { stats: RunStats; onSelectCall: (itemId: string) => void }) {
  return (
    <div className="border-t border-border">
      <div className="flex h-[22px] items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">Method</span>
        {["calls", "err", "p50", "p95", "p99", "max", "rps"].map((column) => (
          <span key={column} className={cn(COLUMN, "text-xs text-muted-foreground")}>
            {column}
          </span>
        ))}
      </div>
      {stats.methods.map((row) => (
        <Stats.MethodRow key={row.method} row={row} />
      ))}
      {stats.slowest && (
        <div className="flex h-[24px] items-center gap-2 px-3">
          <span className="shrink-0 text-xs text-muted-foreground">slowest</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {[stats.slowest.method, stats.slowest.key, formatMs(stats.slowest.durationMs)].filter(Boolean).join(" · ")}
          </span>
          <button type="button" className="ml-auto shrink-0 font-mono text-xs text-primary hover:underline" onClick={() => onSelectCall(stats.slowest!.itemId)}>
            Open in log
          </button>
        </div>
      )}
    </div>
  );
};

Stats.MethodRow = function ({ row }: { row: MethodRow }) {
  return (
    <div data-testid="stats-method-row" className="flex h-[24px] items-center gap-2 border-b border-border px-3">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={row.method}>
        {row.method}
      </span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{row.calls.toLocaleString()}</span>
      <span className={cn(COLUMN, "font-mono text-xs", row.failures > 0 ? "text-destructive" : "text-muted-foreground")}>{row.failures.toLocaleString()}</span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{formatMsBare(row.p50)}</span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{formatMsBare(row.p95)}</span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{formatMsBare(row.p99)}</span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{formatMsBare(row.max)}</span>
      <span className={cn(COLUMN, "font-mono text-xs text-foreground")}>{formatRps(row.rps)}</span>
    </div>
  );
};
