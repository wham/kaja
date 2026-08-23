# Performance testing — spec

A proposal in two halves. The first is for design: a **Stats** view in the console
— what data exists per call, what can honestly be shown, and the states the design
has to cover. The second is for API review: a `kaja` function that runs a block
repeatedly and gives the Stats view something worth charting.

The two are deliberately independent. **Stats is a view over any run** — a plain
paging loop that made 400 calls deserves percentiles too — and the perf function
is what makes a run *shaped* for it: phases, controlled concurrency, a clean
sample set.

## What a call already records

Every call in a run carries (see `MethodCall` in `ui/src/kaja.ts`):

| Field                       | What it gives Stats                                          |
| --------------------------- | ------------------------------------------------------------ |
| app · service · method      | The grouping axis — one aggregate row per `Service.Method`    |
| start timestamp             | The time axis for every chart                                 |
| `durationMs`                | The latency sample (set once, when the call settles)          |
| error, classified           | Outcome, and *why*: HTTP status, gRPC/Twirp code, or transport (`callFailure.ts`) |
| loop key                    | The identifying request value (`GetShow · vera-lune`) — labels an outlier point |
| streaming                   | Message count; a stream's duration is until it completes      |

Everything below is **derivable from those alone**, with no new recording:

- **Percentiles** — p50 / p90 / p95 / p99, min, max, mean; overall and per method.
- **Throughput** — requests per second over time; mean and peak.
- **Error rate** — overall, per method, and broken down by kind and code.
- **Concurrency** — how many calls were in flight at any moment (overlap of
  start + duration intervals).
- **Latency over time** — each call is a (timestamp, duration, outcome) point.

Not recorded today, cheap to add if design wants it: **time to first message**
on streams, and **response size** (bytes of the decoded JSON — honest as a
relative measure, not wire bytes). Neither should block a first design.

**Accuracy guarantee**: stats are counted as calls settle, in the same
append-only pattern as `ItemStats` — never re-derived from retained rows. The
log keeps 20,000 rows per run and says how many it dropped; the stats stay
exact past that, so a 100k-iteration test reports true percentiles while the
log honestly shows its cap. Durations are one number per call, so keeping every
sample for exact percentiles is fine at any realistic scale.

## The Stats view

A third segment on the existing control: **Calls / Canvas / Stats**. The
segment is **always present** — the console header's rule is that nothing about
it moves between runs — and the view shows what there is. Its scope is the
**selected run**, same as the other two views; the run picker and `⌃↑`/`⌃↓`
already step through history, so past runs get stats for free.

### Layout, top to bottom

1. **Headline tiles** — requests · error rate · mean RPS · p50 · p95 · p99.
   One row, `tabular-nums`, the same scale of chrome as the tail bar. Error
   rate wears the status colors (emerald at zero, destructive above).

2. **Timeline** — the centerpiece, x-axis is the run's wall clock:
   - **Latency**: per-time-bucket percentile bands (p50 line, p50–p95 band,
     p95–p99 band) rather than a raw scatter — a scatter at 10k points is
     noise. Failed calls are marks along the bottom edge in destructive red.
     Hovering a bucket states its numbers; clicking a failure mark jumps to
     that call in the Calls view.
   - **Throughput**: requests-per-second bars under the latency chart, sharing
     its x-axis, failures stacked in red.
   - **Concurrency**: a quiet step line (or a third small chart) — during a
     perf test this is where ramp-up/ramp-down is *visible*.
   - **Phases**: a perf-test run shades warm-up / ramp-up / steady /
     ramp-down as background bands with small labels. Warm-up samples are
     drawn dimmed and excluded from the headline tiles (stated in the tile
     strip: `excl. 50 warm-up`). A plain run simply has no bands.

3. **Latency distribution** — a histogram of all samples. Percentile markers
   (p50/p95/p99) as thin rules. This is where a bimodal API (cache hit vs.
   miss) becomes visible, which no percentile table shows.

4. **Per-method table** — one row per `Service.Method`: count · errors ·
   min · p50 · p95 · p99 · max · RPS. Sortable. A run that called one method
   is one row, which is fine. Clicking a row filters the charts above to that
   method; the loop key labels the slowest call (`slowest: GetShow · vera-lune`)
   and links it to the Calls view.

5. **Errors** — only when there are any: one row per distinct failure
   (method + kind + code + first line of message, the same grouping as the
   canvas's failure notices), with a count and `Open in log`.

### Live behavior

The view updates on the frame beat like the log does — a running test streams
into the charts, the time axis grows, and the tail bar's trace mark is still
the running indicator. Nothing in Stats blinks or re-sorts under the cursor:
the method table keeps its order while running, buckets append.

### States the design must cover

- **A run with plenty of calls** — the full page above.
- **A run with one call** — tiles degrade to what's honest (a duration, an
  outcome); no percentiles of one sample, no distribution. Charts collapse to
  the per-method table. (Same rule as the log's duration bars: comparison
  needs something to compare.)
- **A run with no calls** — one quiet line, not an empty dashboard.
- **A stale run read back from the store** — stats summary and charts survive
  (samples are small); the cross-link into Calls may land on a row whose
  payload has expired, which that row already states.
- **A perf-test run vs. a plain run** — phases and the concurrency story are
  the only difference. Same page.
- **Failure-heavy runs** — a test where everything 503s should read clearly:
  red-dominated throughput bars, error tiles, the errors table carrying the
  story. Latency percentiles of failures are stated separately or excluded
  (failed-fast calls poison latency stats — recommend: excluded from latency,
  counted everywhere else, stated on the tile).

### Out of scope for v1

Cross-run comparison and trends (the run picker gives adjacency; a real
comparison view is its own project), exporting reports, thresholds/assertions
UI (a script can assert and draw its own verdict on the canvas), and any
per-payload inspection — that is the Calls view's job.

## The function: `kaja.perfTest`

One function that runs a block on a schedule and marks the run as a perf test.

> Naming note: the `kaja` object is deliberately flat (`askStr`, not
> `ask.str`), so this is `kaja.perfTest` rather than `kaja.perf.test` unless a
> whole `perf` family is coming — one function is not a family.

```ts
import { Shows } from "theatre/shows";

const report = await kaja.perfTest(
  async ({ iteration, vu }) => {
    await Shows.ListShows({ pageSize: 25 });
  },
  {
    iterations: 1000,   // or duration: "30s" — one of the two
    concurrency: 10,    // steady virtual users; default 1
    warmup: 50,         // iterations (or "5s") measured but excluded from stats
    rampUp: "10s",      // 0 → concurrency, linear
    rampDown: "5s",     // concurrency → 0
  },
);

kaja.text(`p95 ${report.latency.p95} ms over ${report.requests} requests`);
```

- **The body is one iteration.** `concurrency` virtual users each run it in a
  loop; every call inside it is sampled. The context argument (`iteration`,
  `vu`) is how a body varies its request data.
- **A failed call fails the iteration, not the test.** The test runs to its
  end and the failures are the data — that is half of what a perf test is for.
  A thrown error in the body counts the same way.
- **The report is returned**, mirroring what Stats shows — counts, RPS,
  latency percentiles, per-method breakdown — so a script can assert its own
  threshold, draw a `kaja.table` of methods, or `kaja.text` a verdict.
- **Asks and approvals are refused inside the body** (they throw): ten VUs
  parked on one question is a deadlock wearing a dialog. Collect inputs
  *before* the test — `kaja.askInt("How many iterations?")` above the call, or
  `kaja.input.iterations` from a deeplink / Run with parameters. A perf script
  parameterized by `kaja.input` gets the existing parameter sheet for free.
- **Stop is the existing Stop**: it aborts the run's calls; ramp-down is
  skipped; the report covers what happened.
- **Phases ride to Stats**: the function reports its phase boundaries and the
  warm-up exclusion; that is the only coupling between the two halves.
- **A perf run opens on Stats** (the same rule as `defaultView` today: a run
  that drew opens on canvas; a run that perf-tested opens on stats — an
  explicit choice still outranks both).

### How it gets used

```ts
// Quick check, no options: 100 iterations, one VU.
await kaja.perfTest(async () => {
  await Shows.GetShow({ showId: "vera-lune" });
});

// Realistic load with varied data, shaped like a deploy check.
const shows = await Shows.ListShows({ pageSize: 100 });
const report = await kaja.perfTest(
  async ({ iteration }) => {
    const show = shows.shows[iteration % shows.shows.length];
    await Shows.GetShow({ showId: show.id });
  },
  { duration: "60s", concurrency: 25, rampUp: "10s", warmup: "5s" },
);

if (report.latency.p99 > 500) kaja.text("⚠ p99 over budget");
```

And without the function at all: any existing loop — a backfill, a paging
sweep — gets the Stats tab as a byproduct, which is how most people will meet
it.

### Open questions

- `duration` strings (`"30s"`) vs. milliseconds — strings read better in the
  one place they're typed; numbers are one rule everywhere else in `kaja`.
- Should `concurrency` accept stages (`[{ to: 50, over: "30s" }, …]`) k6-style
  in v1, or is linear ramp-up/steady/ramp-down enough? (Recommend: enough.)
- Whether a finished test also drops a small summary block on the canvas, so a
  presented run (deeplink, agent) has something there. Recommend yes: one
  block, tiles only, `Open stats` link.
