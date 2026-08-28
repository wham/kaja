# Kaja for agents

Kaja is a client for APIs — gRPC, Twirp and OpenAPI services the user has
configured as **apps**. Every app exposes **services** with **methods**, and a
**script** is a TypeScript file that calls them. This MCP server lets you read
and run those scripts, and — where Kaja owns the workspace it opened — write
them. `tools/list` is what says which: a Kaja serving a workspace it does not own
lists no tool that writes a file.

## The loop

1. `list_services` — the index of what is callable, one TypeScript signature per
   method. Filter with `app`, `service` or `search` on a large API.
2. `describe_method "Shows.ListShows"` — the declarations of every type that
   method's signature names, whether the call reads or writes, and a call to
   start from, carrying the required fields alone. `describe_type "Show"` looks
   one type up on its own, and `describe_type "kaja"` is the runtime a script
   writes its output with.
3. `run_script` with `code` to try it, then `create_script` to keep it — where
   there is one.

**Everything you are shown is TypeScript**, because that is all a script is: the
declarations come out of the generated code your script is checked against, so
there is nothing else to go and read.

## Where an inline run goes

Running a snippet to see what a real response looks like is the right thing to
do, and it is cheap. It is not invisible, though: **an inline `run_script` is run
in a draft in the user's own sidebar**, pinned at the top of their Drafts under
your own name, titled from your code, and every run lands in that draft's console
beside the runs the user made themselves. You get the same draft each time, so
ten tries at one call read as ten runs of one script rather than ten files — and
if you `create_script` exactly what you last ran, that draft becomes the file
rather than leaving a copy behind. The user can clear it like any draft; the next
snippet you run makes another.

Write your snippets as if someone is reading them, because someone can.

## A script runs in the user's window

Not on the server. The script runtime and the service clients live in Kaja's own
window, so `run_script` is forwarded to it. Against a Kaja served over the web
that window is a browser tab the user has open: if none is, `run_script` says so
and nothing else is affected — `list_services`, `describe_method` and
`describe_type` go on answering. Take that answer at face value rather than
retrying; the fix is the user opening Kaja, not a different request.

## Where a script goes

Saved scripts live in folders. `create_script` takes a name that may name one —
`create_script "reports/weekly-usage"` files it under `reports`, creating the
folder if it isn't there — and `rename_script` moves a file the same way, because
on disk renaming and moving are one operation. `list_scripts` reports the folder
each script is filed in. File a script where a person would look for it rather
than dropping everything at the root.

## Read or write

Every method in `list_services` is marked `read` or `write`. A `?` means it was
inferred from the method name because the API doesn't state it; without a `?` the
HTTP verb behind the method settled it. gRPC and Twirp methods have no verb, so
they are always inferred.

**Treat `write` as a real side effect** — confirm with the user before running
one you were not asked for.

## Writing a script

```ts
import { kaja } from "kaja";
import { Seating } from "seating";
import { BoxOffice } from "boxoffice";

const { seatMap } = await Seating.GetSeatMap({ performanceId: "matinee-1" });
const { reservation } = await BoxOffice.Reserve({
  performanceId: "matinee-1",
  seatIds: ["F7", "F8"],
});
kaja.text(`Reserved ${reservation.seatIds.join(", ")} — ${reservation.id}`);
```

Rules that matter:

- The import path is the `importPath` in `list_services`. It is usually just the
  app's name; a module follows it only where the app declares one name twice, so
  write what `list_services` reports rather than assembling it. **Named imports
  only**: `import * as ns from "..."` does not resolve.
- Every method call returns a `Promise`; always `await` it.
- **Send only the fields you mean.** A request is an `Input<T>` — the generated
  type with every field optional — and an omitted field takes its zero value
  rather than failing. Filling every parameter with `""` and `0` sends those
  values, and buries the two or three that carry the meaning of the call. The
  declarations say what a method takes, so a call never has to restate the shape;
  a field the API insists on is marked `[required]`.
- A declaration may carry other marks the type system can't state: `[query
  parameter]`, `[path parameter]`, `[header parameter]` say where a field travels
  in the HTTP request behind the method, and `[carries the HTTP payload]` marks a
  field that exists only to hold a body the shape couldn't otherwise express.
- A rejected call **does not throw**. It is reported as a failed call and the
  script keeps going, with `undefined` where the response would have been — so a
  script with three calls in it reports all three. What stops a script is reading
  a property off that `undefined`; check a response before you use it.
- **A run reports the script's type errors.** A script is transpiled rather than
  compiled, so a type error does not stop one: the run happens, and the report
  lists them under `type errors` at the position the editor puts them, checked
  against the same generated declarations `describe_method` prints. Writing a file
  checks nothing — `write_script` and `create_script` save what they are given — so
  run what you wrote before you leave it behind.
- **Comment the tricky part, and there usually isn't one.** A call names its
  method, the declarations say what its fields are, and the canvas says what came
  out, so a comment restating any of those is a line the reader has to check
  against the code. Write one where the code cannot say *why*: a magic value the
  API insists on, a workaround for something that is broken upstream, an ordering
  that matters. Not a header block over the file, not a banner over each section,
  and not a line above a call saying which call it is.

## A script has no return value

A script is a **body of statements**, not a function. Top-level `await` works;
top-level `return` is a TypeScript error, and Kaja will not run a script that has
one — so a script that hands its answer back by returning it is a file the person
who asked for it cannot press Run on.

**Draw what you produced instead.** `kaja.text(...)`, `kaja.code(...)` and
`kaja.table(...)` are the run's **canvas**, and the canvas is the output — a
script is a file someone opens and presses Run on, so everything it has to say
belongs where they will see it. Never build a table out of Markdown, ASCII or
`console.table`; `kaja.table` is the table.

`console.log(...)` is not that channel. It is the log, which `run_script` hands
back to you, so it is **for you while you are working** — a count, a filtered id,
a shape worth checking before you write the real thing. Leave it out of a script
you keep. You do not need it to see what a call did, either: `run_script` already
reports every call's request and response.

Every level works and is recorded as the level it was printed at —
`console.debug`, `console.log`, `console.info`, `console.warn`, `console.error` —
and so does every other console method (`table`, `time`, `group`, …), which goes
to devtools and is not reported back. There is no `kaja.log`: the standard
console is the logging API. The person whose Kaja this is can mix your lines into
the run's Calls view, so they are not private — but they are not output either.

```ts
import { kaja } from "kaja";
import { Shows } from "theatre";

const table = kaja.table(["id", "title", "seats"]);
let pageToken = "";
do {
  const page = await Shows.ListShows({ pageSize: 50, pageToken });
  for (const show of page.items) {
    table.row(show.id, show.title, show.seatsAvailable);
  }
  pageToken = page.nextPageToken;
} while (pageToken);
```

Rows land one at a time, so the canvas fills as the loop runs rather than after
it. `run_script` reports what you drew — each block's kind, and a table's columns
and row count — so you can check the output landed.

**A row can be rewritten after it is drawn**, which is how a summary table is
built: `.row(...)` hands back a handle, and `.update(...)` takes the same cells
in the same order. Write the row when the work starts and update it when it
finishes, rather than waiting until the end and drawing the table once.

```ts
const table = kaja.table(["show", "seats", "status"]);
await Promise.all(
  shows.map(async (show) => {
    const row = table.row(show.title, show.seatsAvailable, "checking…");
    const seating = await Seating.GetAvailability({ showId: show.id });
    row.update(show.title, seating.available, seating.available > 0 ? "on sale" : "sold out");
  }),
);
```

A row is only ever the whole of itself, so pass every cell, not just the one that
changed; fewer cells than columns leaves the rest blank. `table.column(name)`
adds a column if the run turns out to need one, and the rows already drawn grow a
blank cell for it.

**A cell can be a value you do not have yet.** Hand the table a promise where a
value would go and the row is drawn with everything it already has, with that one
cell loading until it lands — which is what to write when part of a row comes
from a second call:

```ts
const seating = Seating.GetAvailability({ showIds: shows.map((show) => show.id) });
for (const show of shows) {
  table.row(show.id, show.title, seating.then((s) => s.byShow[show.id].available));
}
```

A **function** instead of a promise is work nobody has asked for yet: it is
called when its row is drawn, so rows past the first page cost nothing until
someone pages to them, and a failed one can be retried from the canvas. Nobody is
paging your run, so a function past the first page is never called in it — use a
promise when the value has to be in the run you are reporting. A cell that fails
draws as `—` with the message on hover, and the rest of the table carries on.

**A table can page and search itself.** Hand it the rows instead of pushing
them, and it gets a search box and a pager for free — an array is drawn as it is,
and a function is pulled a page at a time, only when the person reading it pages
past what has been loaded:

```ts
kaja.table(["id", "title", "seats"], async function* (search) {
  for (let pageToken = ""; ; ) {
    const page = await Shows.ListShows({ pageSize: 25, pageToken, query: search });
    yield* page.items.map((show) => [show.id, show.title, show.seatsAvailable]);
    if (!(pageToken = page.nextPageToken)) return;
  }
});
```

Declare the `search` parameter and the search box is handed to your source, which
is started again for each new search; leave it out and the box filters the rows
already loaded. **If the API reports a total, hand it on** — the table counts the
rows it has and nothing else, so `1–50 of 2,431` is a number only your source
knows:

```ts
const customers = kaja.table(["key", "name"], async function* () {
  for (let page = 1; ; page++) {
    const result = await Customers.ListCustomers({ page });
    customers.total(result.totalCount);
    yield* result.items.map((customer) => [customer.key, customer.name]);
  }
});
```

A source paging a cursor has no total and says nothing; the table then reports
what it has loaded and that there is more. **Nobody is paging your run**, so `run_script` draws the first
page and reports `more: true` — if you need the whole set, write the loop and
read it yourself. Prefer this over `.row(...)` whenever the API pages: the person
who opens the script gets the rest without running anything.

## A perf test reports itself

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

## The script runtime

- **No interactive input.** `prompt`, `alert` and `confirm` do nothing and return
  immediately. `kaja.askStr/askInt/askSelect` are how a script asks, and
  `kaja.approve()` how it holds a call back until someone says yes; all park the
  run on a human — only reach for one when a person is at the app.
- **A method hands back a `Call`, not a promise.** It is sent when you await it,
  so `await Shows.ListShows({})` is exactly what it always was. The gap is what
  lets `kaja.approve` hold a call back before it goes out.
- **Headers are the call's, both ways.** A second argument sends them, over the
  ones the app is configured with and matched by name whatever the case. The app's
  own headers and credential go out without a script saying anything — write one
  here only where this call needs it.
- **`withHeaders()` is how the answer's headers are read**, and the only way:
  awaiting a call still hands back the response alone, so nothing about the
  ordinary call changes. Header names are lowercase.

  ```ts
  const { response, headers } = await Shows.CreateShow(
    { title: "Vera Lune" },
    { headers: { "Idempotency-Key": kaja.uuidV4() } },
  ).withHeaders();
  ```
- **Top-level `await` works**: the body runs inside an `async` function.
- There is no DOM and no file system. What a script reaches, it reaches through
  the apps in `list_services`.
- `crypto.randomUUID()` is available, as is `kaja.uuidV4()`.
- The `kaja` object is imported with `import { kaja } from "kaja";`.

## The `kaja` object

**`describe_type "kaja"` returns its full declaration** — the TypeScript the
editor itself is checked against, with this workspace's own variable names in it.
What each member is for:

- `kaja.text(text)`, `kaja.code(code, language?)` — draw a line or a snippet on
  the canvas.
- `kaja.table(columns, rows?)` — draw a table; the handle's `.row(...cells)`
  appends to it and hands back a row whose `.update(...cells)` rewrites it,
  `.column(name)` adds a column, and `.total(count)` states how many rows the
  whole result set holds when the API says. `rows` can be an array, or a source
  (an async generator) the table pulls a page at a time as it is paged through.
  A cell can be a promise or a function rather than a value, and draws as loading
  until it arrives.
- `kaja.perfTest(body, options)` — run a body on a schedule and let the run's
  Stats page report it. The numbers are drawn for you; the report it hands back
  is for judging them. See above.
- `kaja.askStr(question)`, `kaja.askInt(question)`,
  `kaja.askSelect(question, options)` — ask the user for text, a whole number,
  or one of a list; each blocks on a human and hands back the kind of thing it
  asked for, so never ask for text and parse it yourself.
- `kaja.approve(call): Promise<T>` — hold a call until the user approves it, e.g.
  `await kaja.approve(Shows.CreateShow({ … }))`. The call goes inside the
  parentheses, and not approving stops the script. Blocks on a human — though
  they can press **Approve all**, which settles every later call to the same
  method in that run without asking again. So wrapping each call of a loop is
  right: the reader decides where to stop reading, not the script.
- `kaja.variables.<name>` — the user's configured variables, resolved.
- `kaja.input` — what a `kaja://run/<script>?url=…&note=…` link handed this run,
  read by name (`kaja.input.url`). Every value is text, and the whole query
  belongs to the script. Empty when the script is run any other way, so guard a
  parameter (`kaja.input.url ?? ""`) or ask for it with `kaja.askStr` and the
  script works from a link and from the editor alike.
- `kaja.uuidV4(): string` — a random version 4 UUID.
- `kaja.value(json)`, `kaja.struct(json)`, `kaja.listValue(json)` — build a field
  typed `Value`, `Struct` or `ListValue`. Those hold **any** JSON, and their wire
  shape is a `kind` oneof you must never write by hand and never re-implement as
  your own `str`/`num`/`bool` helpers. Where the call `describe_method` gives you
  already fills one in, keep the builder and change the argument.

```ts
import { kaja } from "kaja";
import { Seating } from "seating";

await Seating.Annotate({
  performanceId: "matinee-1",
  note: kaja.value("held for the box office"),
  attributes: kaja.struct({ rows: ["F", "G"], accessible: true, holds: 2 }),
});
```

## Reading a failure

`run_script` reports each failed call with a kind, so you know what to change:

- `INVALID_REQUEST` — the service rejected what you sent. Fix the request.
- `UNAUTHORIZED` — credentials missing or refused. The app's configuration, not
  the request.
- `NOT_FOUND` — the identifier or route is wrong; the shape is fine.
- `RATE_LIMITED` — wait, retry the same request.
- `SERVER` — the service errored. Changing the request shape will not help.
- `TRANSPORT` — the exchange never completed (connection or codec). **Do not
  retry with different parameters**; nothing you send will change it.
