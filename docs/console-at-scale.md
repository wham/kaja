# The console at a thousand calls

A proposal. Nothing here is implemented yet.

A script that loops over a list and calls one method per row is the thing Kaja is
for, and it is also the thing that breaks it. At a handful of calls a second the
console is fine. At a spike — a thousand calls, a fan-out, a paging loop that
does not stop — the window stops answering: the editor drops keystrokes, the log
paints late, and the run you are watching is the reason.

The cause is one decision, not a list of them. **Everything a run produces is
React state at the App root**, so every call is a `setHistory` and every
`setHistory` renders the whole window. The rest of this document is what that
costs, and what to do instead.

## What it costs

Measured on the reducers and derivations themselves, with 46 files in the history
and one file taking a 1000-call spike. This is before React reconciles anything
and before the DOM is touched:

| Per 1000-call spike                             | Cost   | Why                                                                                   |
| ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `recordCall` reducer                            | 96 ms  | `findIndex` + `map` over every item, per update                                        |
| `runningFileIds` / `agentFileIds` / `waitingFileIds` | 448 ms | three memos scanning every item of every file, to answer three yes/no questions        |
| `groupRuns` + `callItems`                       | 126 ms | the grouping is rebuilt from scratch on every render                                   |
| `foldCalls`                                     | 430 ms | its `useMemo` never hits — `groupRuns` hands out a fresh `items` array every render     |
| `formatJson` (prettier) on the payload pane     | 2138 ms | 2.14 ms per payload, once per call, because the selection follows the newest call      |

Just over three seconds of main-thread work that nothing in the UI asked for, and
none of it is rendering. On top of it, structurally:

- **A call is two updates, and each update is two renders.** `client.ts` reports
  a call when it is issued and again when it settles (and once per message when
  it streams). Each lands as a `setHistory`; then the console's `followSelection`
  effect fires on the new item and calls `onSelect`, which is a second
  `setHistory`. So a thousand calls is roughly four thousand renders of the App
  root — Sidebar, CommandRow, Finder, up to ten mounted view bodies, the console
  and the status bar, every time.
- **The clock defeats the row memo.** While anything is in flight `Console` ticks
  `now` every 100 ms and passes it to every `CallRow`. `CallRow` is `memo`ed, and
  the memo is useless: three hundred rows re-render ten times a second for the
  whole spike, so that the two pending ones can count up.
- **The log is not windowed.** Three hundred rows are three hundred DOM nodes.
- **Streaming is quadratic.** `methodCall.streamOutputs = [...streamOutputs,
  message]` copies the whole array per message.
- **The audit log is not the audit log.** `MAX_ITEMS_PER_FILE` is 300, so a
  1000-call run keeps 300 of them and drops 700 silently. The log is the surface
  that is supposed to be *complete at any length* — the tail bar says `13 more`,
  not `13 more and 700 gone`. Today, at the scale this document is about, it
  lies.

## The change

**A run's contents stop being React state.** A run is an append-only buffer
outside React; the console subscribes to it and renders a window over it. React
keeps only what is small and slow-moving: which runs exist, which is selected,
which tab, which view, which file. That is one architectural move and everything
below follows from it.

### 1. A run is a buffer

`RunBuffer` — a plain object per run, holding `items` (append-only), a
`Map<callId, index>` for the patch path, and the aggregates the console reads,
maintained on append rather than recomputed on render: `status`, `failures`,
`inFlight`, `slowest`, `awaiting`, and the canvas's folded entries. Appending is
O(1); settling a call is a map lookup and an in-place write.

Two things this deletes rather than speeds up:

- **`groupRuns`.** The grouping *is* the buffer. Nothing rebuilds it, and the
  arrays it hands out are stable, so `foldCalls`' memo starts working — or rather
  stops being needed, because the fold is maintained incrementally too: an
  appended call either extends the current group (same method, consecutive) or
  opens a new one.
- **The three sidebar memos.** `running` / `waiting` / `agent` are three booleans
  the buffer keeps. They are published as their own tiny subscription that
  notifies only when a flag actually flips, which for a spike is twice.

`recordCall` copying the `MethodCall` is worth naming: `client.ts` mutates that
same object again on settle anyway, so the copy buys immutability the producer
does not honour. The buffer stores the call and notifies; there is nothing to
copy.

Subscription is `useSyncExternalStore` over a version counter.

### 2. Notification is coalesced to the frame

A buffer still notifies a thousand times. It shouldn't: the buffer notifies at
most once per animation frame (a timer when the tab is hidden), so two hundred
calls landing in one frame are one render. This subsumes the 100 ms clock — the
elapsed counter rides the same tick, and it touches only rows that are pending.

### 3. The log is windowed, and complete

Rows are a fixed 24 px (`CALL_ROW_HEIGHT`), which is exactly what makes windowing
arithmetic rather than measurement: render `ceil(height / 24) + overscan` rows
from `floor(scrollTop / 24)`, with spacers above and below. `useRowsBelow`
already computes that arithmetic to write the tail bar; it becomes the windowing
instead of a separate measurement of it. Forty DOM rows instead of a thousand,
and the tail bar goes on saying what is below.

Then the count cap goes. **Cost is the payload, not the row** — a row is a
method name, a loop key, a duration and a status, and ten thousand of those are
nothing. So the budget is bytes: a run keeps payloads for the newest N MB and
drops the payloads (never the rows) past it, marked with the same
`Response no longer kept` state `runStore` already shows for expiry. A 5000-call
spike then keeps 5000 scannable rows, of which the oldest say their payload is
gone. That is more honest than dropping the rows, and it is what the log claims
to be.

### 4. Nothing follows the selection during a spike

`followSelection` moves the cursor to each call as it is issued. At five calls a
second that is the right behaviour; at five hundred it is the most expensive
thing in the room, because the payload pane reformats and re-`setValue`s Monaco
for every one of them.

Make it tail-follow, like a terminal: follow the newest call while the log is
scrolled to the bottom, drop out of it the moment the user scrolls up or clicks a
row, and offer `Jump to latest` to get back. A run arriving still takes the
console — that rule is unchanged and is what pressing Run means.

### 5. The payload pane stops running prettier

Three parts, in order of size:

- **`JSON.stringify(value, null, 2)` instead of `formatJson`.** Prettier's JSON
  printer differs from `stringify` only in places nobody reads a response for,
  and it costs 2.14 ms and a parser download per payload against roughly 0.02 ms.
  Prettier stays where it earns its keep: generated TypeScript.
- **Drop stale formats.** The effect in `JsonViewer` has no cancellation, so a
  slow format can land over a newer selection. Whatever formats, it formats for
  the selection that is current when it finishes.
- **A size ceiling.** Past a couple of megabytes, show the raw text and say so
  rather than pretty-printing a payload nobody is going to read to the end.

### 6. Nothing about the console reaches the editor

Once the console subscribes to its buffer, the App root stops re-rendering per
call and Monaco stops competing for the main thread — which is the whole of what
makes the editor stutter, since Monaco is imperative and none of this touches it.
Two leftovers close the gap: lift the run state out of `App.tsx` into a store of
its own so a console change cannot reach `Sidebar`, `CommandRow` or the mounted
view bodies at all, and `memo` the view bodies on their view id so the ten
mounted views do not reconcile behind the one on screen.

### 7. Backpressure at the door

Three per-call costs upstream of the console, each doing work for a feature that
does not need it a thousand times:

- **`streamOutputs`** appends by copying. Push, and notify on the frame.
- **`rememberValues`** walks the request and the response of every settled call
  and writes to the type-memory cache, to feed a completion list that keeps five
  values per field. Sample it — the first few calls per method per run — and the
  suggestions are identical.
- **`recordUse`** rewrites the tree-expansion ledger per call, and the ledger
  keeps three entries. Skip the write when the method is already at its head.

## Order

The first four are independent, cheap, and worth about an order of magnitude
between them:

1. `formatJson` → `JSON.stringify`, plus stale-drop in `JsonViewer` — 2.1 s.
2. The three sidebar sets, maintained rather than scanned — 450 ms.
3. Stable group identity so `foldCalls` memoizes — 430 ms.
4. Frame-coalesced notification and tail-follow selection — the render storm.

Then 5, the buffer, virtualization and the byte-budgeted log, which is what makes
"thousands" correct rather than merely fast.

## What this deliberately does not do

- **No collapsing or summarising the log.** Its job is to be complete; windowing
  gives that for free, and a fold there would be the canvas's job done twice.
- **No worker.** The work is re-rendering, not JSON. Moving it off-thread splits
  the state and fixes nothing.
- **No throttling the calls.** The script decides how many calls it makes.
