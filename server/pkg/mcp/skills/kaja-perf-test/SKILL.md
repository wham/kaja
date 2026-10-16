---
name: kaja-perf-test
description: Write a Kaja script that load-tests an API with kaja.perfTest. Read before choosing a schedule or reporting what a perf test measured.
---

# A perf test reports itself

`kaja.perfTest(body, options)` runs a body on a schedule — `concurrency` virtual
users each running it in a loop — and samples every call inside it. What comes
out is a whole page: the run opens on its **Stats** tab, with requests,
throughput, error rate, the percentiles, latency over time, the distribution,
concurrency and a row per method, and the canvas gets a tile carrying the same
headline and the way there.

**So don't draw those numbers again.** A `kaja.table` of p50/p90/p99 is the Stats
page retyped, and a narrower reading of it. The report handed back is there to be
judged against something — a budget, another schedule, the method that got slow —
which is the one thing Stats cannot say. Draw that sentence, or draw nothing:

```ts
const report = await kaja.perfTest(
  ({ iteration }) => Shows.GetShow({ showId: ids[iteration % ids.length] }),
  { duration: "30s", concurrency: 10, warmup: "2s", rampUp: "5s", rampDown: "2s" },
);
const p99 = Math.round(report.latency.p99 ?? 0);
kaja.text(p99 <= 400 ? `p99 ${p99} ms, inside the budget.` : `p99 ${p99} ms, over the 400 ms budget.`);
```

The budget is `iterations` or `duration`, never both, and `duration` is the whole
test with its ramps inside it. A numeric `warmup` is iterations and a string is
time; either way those calls are measured and then left out of the percentiles. A
failed call fails its iteration, not the test. `kaja.askStr` and `kaja.approve`
throw inside the body — ten virtual users parked on one question is a deadlock
wearing a dialog — so ask before the test, or take the value from `kaja.input`.
