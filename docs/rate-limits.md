# The signal

A script that loops over a list and calls one method per row is the thing Kaja is
for. Against an API that meters its traffic, it is also the thing that gets you
refused halfway down the list — a hundred rows in, `429`, and the run ends with
sixty rows filled and forty holding `undefined`.

The server has a rate limiter. This is the other half of it: the thing on this
side that reads what the server says about the budget and spends it accordingly.
Not a limiter you configure — one that **learns the limit off the responses and
obeys it**, so a script written without a thought for pacing survives a list of
ten thousand.

This is a draft. Nothing here is built.

## The shape

```ts
import { kaja } from "kaja";
import { Shows as ShowsApi } from "theatre";

const limit = kaja.rateLimit();
const Shows = limit.wrap(ShowsApi);

const page = await Shows.ListShows({ pageSize: 100 });
for (const show of page.shows) {
  await Shows.GetShow({ showId: show.id });
}
```

Two lines at the top, and every call site below is the code you already wrote.
**Enrolling a service is the whole gesture** — the import is aliased, the paced
name takes the original, and the loop never mentions the limiter again.

The alias is deliberate rather than tolerated. There is no run-wide pacing and
no ambient one, for the reason [AGENTS.md](../AGENTS.md) gives about headers: a
binder holding something for "every call in this script" is what makes a value
meant for one app reach the next app the script imports. **A limit belongs to
the API, so the service is the honest thing to attach it to**, and a `const` at
the top is a scope the reader can see.

For an API that publishes no headers at all — and there are many — what you know
is stated instead:

```ts
const limit = kaja.rateLimit({ perSecond: 10 });
```

**What you declare is a floor the limiter never exceeds; what the API says is the
ceiling it obeys; the tighter of the two wins.** So a declared `perSecond` is not
overridden by a generous header, and a header that says the budget is nearly gone
is not overridden by a comfortable `perSecond`.

## What it reads

Every response already carries this. `MethodCall.upstreamResponseHeaders` holds
what the API itself sent where Kaja carried the call, `responseHeaders` the
transport's own where nothing did, and `callResponseHeaders` already picks
between them and lowercases the names — which is the whole of the plumbing, and
it is why **observation costs nothing and is always on**. The limiter is what
turns the reading into waiting.

| Header                                                    | Read as                                             |
| --------------------------------------------------------- | --------------------------------------------------- |
| `ratelimit-limit` · `-remaining` · `-reset`                | the IETF draft family                                |
| `ratelimit: limit=100, remaining=50, reset=60`             | the same, as one structured field                    |
| `x-ratelimit-limit` · `-remaining` · `-reset` · `-used`    | the de-facto spelling, and the common one            |
| `x-rate-limit-*`                                           | the hyphenated variant                               |
| `x-ratelimit-reset-after`                                  | always a delta, never a timestamp                    |
| `retry-after`                                              | seconds or an HTTP-date, and **outranks everything** |
| gRPC `resource_exhausted`, `grpc-retry-pushback-ms`        | the same three states with no headers at all         |

**The one genuinely ambiguous field is `reset`**, which is a Unix epoch at one
API and seconds-from-now at the next, with no way to ask which. The rule that
settles it without configuration: a value of 10⁹ or more is an epoch (10⁹ seconds
is the year 2001, and nobody's window is 31 years long), 10¹² or more is epoch
milliseconds, and anything smaller is a delta. A `*-reset-after` is a delta
whatever its size, because its name says so. Non-numeric is an HTTP-date.

`retry-after` outranks the rest because it is the server answering the question
directly rather than describing a budget the client has to do arithmetic on.

## Three states, which is why it is a signal

Let `remaining` and `limit` be the last thing the API said, and `resetAt` when
the budget refills.

**Clear** — there is headroom, so nothing waits. The script's own speed is the
right speed, and the limiter is invisible. This is where a script that makes
three calls against a 5,000/hour budget stays, and it is why the limiter is safe
to leave in a script that does not need it.

**Pacing** — headroom is below the reserve (20% by default), so what is left is
spread over the time that is left: `delay = (resetAt − now) / remaining`. Five
requests and sixty seconds is one every twelve seconds. **The last requests are
rationed rather than refused**, and the budget lands exactly on the reset instead
of running out at second nine. A script slower than the pace still never waits.

**Held** — `remaining` is zero, or a `429` came back, or `retry-after` said so.
Every enrolled call waits for the reset.

Green, amber, red. The user's instinct about the drawing was right, and it is
right because the mechanism genuinely has three states and not four.

Two details that are easy to get wrong and expensive to get wrong:

- **`remaining` is only true as of the last response.** Twenty calls issued in
  parallel would all read `remaining: 5` and all go. So the limiter **decrements
  on issue and corrects on response** — the count in hand is the API's last word
  minus what is in flight.
- **The budget is per API, not per script.** State lives on `KajaHost`, beside
  the variables and the live tables, keyed by bucket — the app by default, split
  automatically when the API names its own (`x-ratelimit-resource`,
  `x-ratelimit-bucket`). So a second run knows what the first one learned.
  **Observation is shared; obedience is opted into**: an unenrolled script is
  never slowed by somebody else's limiter.

## Where the waiting happens, and where it must not show up

**A held call has not been made yet.** The wait is before `Call.start()`, in the
one-tick gap `kaja.approve` already uses — `claim()` the call, wait for a permit,
then start it. Everything that follows from that is the point:

- **Latency stays honest.** `durationMs` is stamped inside `send()`, so a call
  that waited ten seconds and took forty milliseconds reports forty
  milliseconds. A limiter that waited inside the call would put its own queue
  into the p99 and the Stats page would describe the server as slow when it was
  the script being polite.
- **The log stays honest.** It is the flat audit log, one row per call in wall
  order, always complete — and a call that has not gone out is not a call. The
  queue is the limiter's to report, not the log's.
- **Stop reaches it.** A run parked on a permit is parked exactly as one parked
  on a question is, so the queue honours `_internal.abortSignal` and Stop ends
  the run rather than leaving it waiting on a clock nobody is watching.
- **Settling waits for it.** A run whose only outstanding work is a queued permit
  is a running run, so the queue counts as work to `settleIfQuiet` — otherwise
  the run gets a duration while it still has calls to make.

And one thing it must not do: **it must not turn anything amber outside its own
frame.** In Kaja amber means *this run is waiting for you* — the ring on the
sidebar row, the run pill, the dot on the Canvas tab. A held run is waiting for a
clock and needs nothing from anybody, so `isAwaitingUser` stays false for this
block and the sidebar keeps its spinner. A signal at danger inside the block is
fine; the window asking to be looked at is not.

## What it draws

A block on the canvas, live while the run goes and a record once it is over —
the same life a perf block has, and the same frame: `rounded-lg border`, a 28px
header on `bg-card`, tiles under it.

```
┌─────────────────────────────────────────────────────────────┐
│ ● rate limit   theatre              resets in 43s           │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ budget       │ calls        │ held         │ waited         │
│ 118 / 5,000  │ 4,882        │ 61           │ 12.4s          │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

The lamp is the state and the countdown runs live. The budget reads
`remaining / limit`, which is the one number worth a glance. A queue depth
appears in the header only while there is one (`3 waiting`), and the reset
counts down only while pacing or held — **a block with nothing happening in it
does not animate**, so the beat (250ms, the perf block's) runs only in those two
states and every other redraw rides a call landing.

Once the run is over the block states its totals in the past tense, like every
other settled block: what was let through, what was held, how long that cost.

## Refused calls

A limiter that never trips is the goal, not the guarantee — the budget can
already be spent when the script starts, or shared with something else. So a
`429` has to be handled, and the tempting answer is to send the call again.

The reason that is dangerous is that a retried write is a double write. But Kaja
already knows the difference: `Method.http` carries `"GET /shows"`, and
`catalog.go` already reads a verb into read-or-write **with a flag saying whether
it knew or guessed** — a verb settles it, a method name is only a signal.

So: **retry what is certainly a read, and nothing else.** `retry: "reads"` is
the default, `"never"` and `"all"` are there for the cases the author knows
better than the header does, and a method whose effect was guessed from its name
is not retried — a guess is not enough to justify re-sending a request that might
create something.

Every retry is **its own row in the log**. The log is the audit log; a call the
run made twice appears twice, and the block's `retried` count is what says the
two rows are one intention.

`maxWait` (default `5m`) is the backstop. Past it the call goes out and is
refused, because a script that ends in a real error beats one that never ends.

## What a script gets back

```ts
const report = limit.report();
if (report.held > 0) {
  kaja.text(`${report.held} calls held, ${(report.waitedMs / 1000).toFixed(1)}s waiting`);
}
```

The same bargain `perfTest` strikes: the numbers are already on the canvas, so
the report exists to be **judged** — against a budget, against how long the job
is allowed to take — rather than drawn a second time.

For an agent, `run_script` should carry the same headline in its block report.
An agent that sees a run take ninety seconds and cannot tell whether the API was
slow or the budget was gone will draw the wrong conclusion and change the wrong
thing.

## Open, and deliberately out

**Open.** The name — `limit.wrap(Shows)` is discoverable in the completion list
and dull; a callable limiter (`limit(Shows)`) reads better and hides from
completion, which in an editor-first runtime is the more expensive half. Whether
enrolling a whole service is too coarse, and if it is, whether the fix is a
per-call form (`await limit(Shows.GetShow({ id }))`, exactly the `approve` shape)
or a per-method cost table for the APIs that price calls in points. Whether the
generated import should offer to enrol itself once a script has a limiter.

**Out.** A rate limit declared per app in `kaja.json` — tempting, and it makes
every script polite for free, but `Configuration` is the file and this is run
behaviour, and free politeness is exactly the silent pacing that would make a
perf test lie. Persisting a budget across restarts: stale state about a window
that has almost certainly rolled is worse than learning it again on the first
call. Coordination between two Kajas, which is a distributed lock wearing a
helpful hat.

**Not out, and next.** The Stats page already draws phase bands behind its
charts; held stretches belong there for the same reason, so a paced plateau is
never read as a slow server. And a budget tile beside the throughput one is the
account of what the run actually cost.
