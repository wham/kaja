# The console at a thousand calls

A script that loops over a list and calls one method per row is the thing Kaja is
for, and it used to be the thing that broke it. At a spike — a thousand calls, a
fan-out, a paging loop that does not stop — the window stopped answering: the
editor dropped keystrokes, the log painted late, and the run you were watching
was the reason.

This is what it cost, what changed, and what it costs now. The architecture is
recorded in [AGENTS.md](../AGENTS.md); this is the account of why.

## What it cost

The cause was one decision, not a list of them. **Everything a run produced was
React state at the App root**, so every call was a `setHistory` and every
`setHistory` rendered the whole window.

Measured on the reducers and derivations alone, with 46 files in the history and
one file taking a 1000-call spike — before React reconciled anything and before
the DOM was touched:

| Per 1000-call spike                             | Cost    | Why                                                                                 |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `recordCall`                                    | 96 ms   | `findIndex` + `map` over every item, per update                                      |
| `runningFileIds` / `agentFileIds` / `waitingFileIds` | 448 ms  | three memos scanning every item of every file, to answer three yes/no questions      |
| `groupRuns` + `callItems`                       | 126 ms  | the grouping rebuilt from scratch on every render                                    |
| `foldCalls`                                     | 430 ms  | its `useMemo` never hit — `groupRuns` handed out a fresh `items` array every render   |
| `formatJson` (prettier) on the payload pane     | 2138 ms | 2.14 ms per payload, once per call, because the selection followed the newest call   |

Just over three seconds of main-thread work that nothing in the UI asked for, and
none of it rendering. On top of it, structurally: a call was two updates and each
update was two renders (the console's `followSelection` effect wrote back), so a
thousand calls was roughly four thousand renders of the App root. The 100 ms
elapsed clock was passed to every row, so three hundred rows repainted ten times
a second for the whole spike. The log was not windowed. Streaming appended by
copying. And `MAX_ITEMS_PER_FILE` was 300, so a 1000-call run kept 300 rows and
dropped 700 silently — the surface whose whole job is to be complete was not.

## What changed

**A run's contents are no longer React state.** A run is an append-only buffer in
`consoles.ts`; the console alone subscribes to it, on the frame. Everything else
follows from that:

1. **The buffer.** Items are appended and a settling call is the same object
   written again, so nothing is copied per update. What a run says about itself —
   status, failures, slowest, wall time, in-flight — is counted as items arrive
   (`ItemStats`), and so is the canvas's account of the run's calls (`RunStrip`,
   which replaced the fold `CallFold` maintained the same way). The pure
   functions `ItemStats` replaced are kept as the definition it is tested
   against, so the fast path and the rule cannot become two rules.
2. **Frame coalescing.** Two hundred calls between two paints are one repaint.
   Gestures — a click, a run starting or ending, a question drawn — still notify
   at once.
3. **The three sidebar sets** are booleans the store keeps, on their own
   subscription. A call never touches them.
4. **Settling** hangs off the store (`subscribeQuiet`) instead of being asked
   again on every render.
5. **The log is windowed** over its fixed 24px row, so forty rows are in the
   document where there are two thousand — and the count cap is gone. Rows are
   kept to 20,000 per run and payloads to the newest 500 per file, each stating
   itself where it stops.
6. **The log tail-follows** like a terminal and stops when you scroll off the
   bottom, with `↓ Latest` to come back.
7. **The payload pane prints** with `JSON.stringify` instead of parsing with
   prettier.
8. **Backpressure at the door**: streamed messages are appended rather than
   copied, and remembering values for the completion list is sampled to the first
   few calls per method per run — it feeds a list that keeps five values a field.

## What it costs now

The same spike, driven through the real UI in a browser: 2000 calls, 100
concurrent, against the demo gRPC app.

|                                | Before  | After  |
| ------------------------------ | ------- | ------ |
| Main thread blocked (>50ms tasks) | 2589 ms | 566 ms |
| Long tasks                     | 25      | 8      |
| Frames painted during the run   | 12.8/s  | 23.7/s |
| Run wall time                  | 6509 ms | 4596 ms |
| Call rows in the DOM           | 300     | 25     |
| Calls the log kept             | 300 of 2000 | 2000 of 2000 |

The log is complete and the window stays responsive. The remaining wall time is
the calls themselves.

## What this deliberately does not do

- **No collapsing or summarising the calls view.** Its job is to be complete;
  windowing gives that for free, and summarising there would be the canvas's
  strip done twice.
- **No worker.** The work was re-rendering, not JSON. Moving it off-thread would
  have split the state and fixed nothing.
- **No throttling the calls.** The script decides how many calls it makes.
