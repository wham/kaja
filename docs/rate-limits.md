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

## What happens without being asked

Two different things get called "respecting a rate limit", and they deserve
opposite defaults.

**Obeying a refusal costs nothing, so Kaja does it by default.** When the API
says `remaining: 0`, or answers `429`, the next call cannot succeed. Sending it
anyway is not the fast option — it is the option where you lose the data *and*
spend a request to be told so. Waiting out a reset that is seconds away is
strictly better than being refused, and there is no judgement in it to put to
the author.

**Rationing a budget you still have is a trade, so it is stated.** Spreading what
is left over the time that is left buys safety with speed, and how much reserve
to keep is a real decision. But the statement belongs on the app rather than in
the script — see below — so "stated" costs a script nothing either.

The line between them is the cap. **A reset a few seconds out is waited through;
a long one is reported instead** — silently parking a run for the 47 minutes
GitHub's hourly window can have left is worse than a clean failure, so past
`maxWait` (10s by default, and the arguable part of this) the call goes out, is
refused, and the block says why. `kaja.rateLimit({ maxWait: "1h" })` is how you
say you would rather wait.

The one place the default hold is off is inside `kaja.perfTest`, whose whole job
is to find the wall and report where it is. A perf test that silently paced
itself would measure Kaja.

## The shape

```ts
import { Shows } from "theatre";

const page = await Shows.ListShows({ pageSize: 100 });
for (const show of page.shows) {
  await Shows.GetShow({ showId: show.id });
}
```

**That is the whole of it, and the cleanest API here is the one nobody writes.**
An earlier draft had the script take the service, wrap it and hand the name
back — `import { Shows as ShowsApi }`, then `const Shows = limit.wrap(ShowsApi)`
— which says "Shows" three times to end up with one Shows, and reads like
plumbing because it is. The fault was not the spelling. **The script was being
made to hold a number that belongs to the API**, and anything a script holds it
must also name, alias and thread.

So the question is not what the verb should be called. It is which of three
places each fact belongs in, and the answer puts almost nothing in the script.

**What the API says goes in the response, and is read.** No API, no line, no
opt-in. This is the layer that covers most real APIs and all of the ones that
publish headers.

**What the API documents but does not send goes on the app.** An API that says
"60 per minute" in its docs and sends nothing is stating a fact about itself,
identical for every script that ever calls it — so it is written once, where the
URL and the credential already live:

```json
{ "name": "theatre", "grpc": { "url": "…", "rate_limit": "60/m" } }
```

The draft called this out of scope on the grounds that `Configuration` is the
file and pacing is run behaviour. That was wrong, and the app's own schema says
so: `GrpcApp` already carries `tls`, `auth`, `headers`, `ca_file`,
`insecure_skip_verify` — an entire family of *how to talk to this API*, which a
rate limit is a plain member of. Writing it into every script that imports the
app was the actual error.

**What this one run wants differently goes in the script — and only that.**

```ts
const limit = kaja.rateLimit(Shows, { perSecond: 5 });
```

`Shows` is *pointed at*, never replaced. A script already refers to an app by
importing a service from it, so a service is how you name an app without
resorting to a string — and nothing is reassigned, so the name in the loop is
the name in the import. Implementable as it stands: `bind()` in `client.ts`
closes over `appRef.configuration.name`, and `Methods` is a string index
signature, so a `Symbol` key carries the app invisibly to completion and to
`Object.keys`.

**The tighter of the two wins.** A declared limit is a floor the pacing never
exceeds; what the API says is the ceiling it obeys. A generous header does not
loosen a stated `60/m`, and a comfortable `60/m` does not override a header
saying the budget is nearly gone.

### Rejected

**A lexical scope** — `await kaja.rateLimit({ … }, async () => { … })` — is
visible, honest about its extent, and indents the entire body of a script whose
entire body is API calls. A script language that reads beautifully cannot make
its common case one level deeper.

**An import attribute** — `import { Shows } from "theatre" with { rateLimit:
"60/m" }` — is real syntax and puts the fact next to the app it belongs to, but
it is a magic string in a module specifier, repeated in every script, which is
the app's configuration written in the worst available place.

**A bare run-wide `kaja.rateLimit({ perSecond: 10 })`** with no app named. The
[AGENTS.md](../AGENTS.md) objection to run-wide *headers* does not transfer — a
misplaced credential reaches the wrong server, a misplaced pace only makes a
script slower — but a declared number genuinely has to say which API it is about,
and buckets are per app. Header-driven pacing needs no such form: an API that
advertises no limit and declares none is never paced, so "apply to everything" is
already what happens.

## What it reads

Every response already carries this, and the plumbing is already built.
`MethodCall.upstreamResponseHeaders` holds what the API itself sent where Kaja
carried the call, `responseHeaders` the transport's own where nothing did, and
`callResponseHeaders` picks between them and lowercases the names. The maps are
forwarded whole rather than filtered, and `UpstreamError` carries them too — so
**the headers on the `429` itself survive**, which is exactly the response whose
`retry-after` is worth reading. `withHeaders()`'s own JSDoc already uses
`headers["x-ratelimit-remaining"]` as its example; this is that example stopping
being the reader's job.

| Header                                                    | Read as                                             |
| --------------------------------------------------------- | --------------------------------------------------- |
| `ratelimit-limit` · `-remaining` · `-reset`                | the IETF draft family                                |
| `ratelimit: limit=100, remaining=50, reset=60`             | the same, as one structured field                    |
| `x-ratelimit-limit` · `-remaining` · `-reset` · `-used`    | the de-facto spelling, and the common one            |
| `x-rate-limit-*`                                           | the hyphenated variant                               |
| `x-ratelimit-reset-after`                                  | always a delta, never a timestamp                    |
| `retry-after`                                              | seconds or an HTTP-date, and **outranks everything** |
| gRPC `resource_exhausted`, `grpc-retry-pushback-ms`        | the same three states with no headers at all         |

**There is no standard here, but there is a convention, and it is a strong one.**
`Retry-After` is the only genuinely standardised header of the set (RFC 9110),
and it only appears once you have already been refused. The `RateLimit-*` family
is an IETF draft that has not landed. What everything else has in common is not a
spelling but a *shape*: limit, remaining, reset, as three integers. So the three
spellings — `RateLimit-*`, `X-RateLimit-*`, `X-Rate-Limit-*` — are read as one
thing, because they are one thing, and matching all three costs a lookup rather
than a decision.

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

**Pacing** — headroom is below the reserve (20% by
default), so what is left is spread over the time that is left:
`delay = (resetAt − now) / remaining`. Five requests and sixty seconds is one
every twelve seconds. **The last requests are rationed rather than refused**, and
the budget lands exactly on the reset instead of running out at second nine. A
script slower than the pace still never waits.

**Held** — `remaining` is zero, or a `429` came back, or `retry-after` said so.
The next call waits for the reset, up to `maxWait`.

Worked against a real set of headers — 60 an interval, spent, six seconds to go:

```
X-Rate-Limit-Limit:     60     the budget
X-Rate-Limit-Remaining: 0      → Held
X-Rate-Limit-Reset:     6      → 6 is far below 10⁹, so six seconds, not 1970
```

Six seconds is inside `maxWait`, so the run holds and resumes rather than
collecting six refusals. Nothing was written in the script and nothing was
configured; the API said it, and this is only Kaja not arguing.

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
  A budget is a fact about the API, so **learning it is shared and paying for
  it is too** — the second script does not have to rediscover the wall by
  hitting it.

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

Pacing that nobody asked for is still pacing that someone may want to read, so
naming an app with no options is how you ask what happened to it:

```ts
const limit = kaja.rateLimit(Shows);
// … the script …
if (limit.held > 0) {
  kaja.text(`${limit.held} calls held, ${(limit.waitedMs / 1000).toFixed(1)}s waiting`);
}
```

The handle reads live rather than returning a snapshot, so where it is declared
does not change what it says.

The same bargain `perfTest` strikes: the numbers are already on the canvas, so
the report exists to be **judged** — against a budget, against how long the job
is allowed to take — rather than drawn a second time.

For an agent, `run_script` should carry the same headline in its block report.
An agent that sees a run take ninety seconds and cannot tell whether the API was
slow or the budget was gone will draw the wrong conclusion and change the wrong
thing.

## Open, and deliberately out

**Open.** `maxWait`'s default: 10s is a guess at the line between "the run is
slow" and "the run is stuck", and it is the number most worth arguing about,
because it is the one thing the default hold does that the author did not ask
for. What `rate_limit` should accept — `"60/m"` reads well and is one more small
grammar to parse, where `{ perMinute: 60 }` is plainer and wordier in the file
that has to hold it. Whether the app form states an observed limit back to you
once a call has been made, which would make the field mostly unnecessary to fill
in by hand. And a per-method cost table for the APIs that price calls in points
rather than counting them, which is the one thing a single number cannot say.

**Out.** Persisting a budget across restarts: stale state about a window
that has almost certainly rolled is worse than learning it again on the first
call. Coordination between two Kajas, which is a distributed lock wearing a
helpful hat.

**Not out, and next.** The Stats page already draws phase bands behind its
charts; held stretches belong there for the same reason, so a paced plateau is
never read as a slow server. And a budget tile beside the throughput one is the
account of what the run actually cost.
