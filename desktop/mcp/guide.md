# Kaja for agents

Kaja is a desktop client for APIs — gRPC, Twirp and OpenAPI services the user has
configured as **apps**. Every app exposes **services** with **methods**, and a
**script** is a TypeScript file that calls them. This MCP server lets you read,
write and run those scripts.

## The loop

1. `list_services` — the index of what is callable, one TypeScript signature per
   method. Filter with `app`, `service` or `search` on a large API.
2. `describe_method "Shows.ListShows"` — the declarations of every type that
   method's signature names, whether the call reads or writes, and a call to
   start from. `describe_type "Show"` looks one type up on its own, and
   `describe_type "kaja"` is the runtime a script writes its output with.
3. `run_script` with `code` to try it, then `create_script` to keep it.

**Everything you are shown is TypeScript**, because that is all a script is: the
declarations come out of the generated code your script is checked against, so
there is nothing else to go and read.

## Where an inline run goes

Running a snippet to see what a real response looks like is the right thing to
do, and it is cheap. It is not invisible, though: **an inline `run_script` is run
in a scratch buffer in the user's own sidebar**, titled from your code, and every
run lands in that buffer's console beside the runs the user made themselves. You
get the same buffer each time, so ten tries at one call read as ten runs of one
script rather than ten files — and if you `create_script` exactly what you last
ran, that buffer becomes the file rather than leaving a copy behind.

Write your snippets as if someone is reading them, because someone can.

## Read or write

Every method in `list_services` is marked `read` or `write`. A `?` means it was
inferred from the method name because the API doesn't state it; without a `?` the
HTTP verb behind the method settled it. gRPC and Twirp methods have no verb, so
they are always inferred.

**Treat `write` as a real side effect** — confirm with the user before running
one you were not asked for.

## Writing a script

```ts
import { Seating } from "seating/proto/seating";
import { BoxOffice } from "boxoffice/proto/boxoffice";

const { seatMap } = await Seating.GetSeatMap({ performanceId: "matinee-1" });
const { reservation } = await BoxOffice.Reserve({
  performanceId: "matinee-1",
  seatIds: ["F7", "F8"],
});
console.log(reservation);
```

Rules that matter:

- The import path is the `importPath` in `list_services` — the app name, then the
  module. **Named imports only**: `import * as ns from "..."` does not resolve.
- Every method call returns a `Promise`; always `await` it.
- **Send only the fields you mean.** A field is optional unless its declaration
  is marked `[required]`, and an omitted field takes its zero value rather than
  failing. Filling every parameter with `""` and `0` sends those values.
- A declaration may carry other marks the type system can't state: `[query
  parameter]`, `[path parameter]`, `[header parameter]` say where a field travels
  in the HTTP request behind the method, and `[carries the HTTP payload]` marks a
  field that exists only to hold a body the shape couldn't otherwise express.
- A rejected call **does not throw**. It is reported as a failed call and the
  script keeps going, with `undefined` where the response would have been — so a
  script with three calls in it reports all three. What stops a script is reading
  a property off that `undefined`; check a response before you use it.

## A script has no return value

A script is a **body of statements**, not a function. Top-level `await` works;
top-level `return` is a TypeScript error, and Kaja will not run a script that has
one — so a script that hands its answer back by returning it is a file the person
who asked for it cannot press Run on.

**Say what you produced instead.** There are two channels, and a script normally
uses both:

- `console.log(...)` — the transcript, returned to you by `run_script`.
- `kaja.text(...)`, `kaja.code(...)`, `kaja.table(...)` — the run's **canvas**,
  which is what the person watching sees. Anything you would have formatted for
  a human belongs here.

Never build a table out of Markdown, ASCII or `console.table`. `kaja.table` is
the table.

```ts
import { kaja } from "kaja";
import { Shows } from "theatre/proto/theatre";

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
already loaded. **Nobody is paging your run**, so `run_script` draws the first
page and reports `more: true` — if you need the whole set, write the loop and
read it yourself. Prefer this over `.row(...)` whenever the API pages: the person
who opens the script gets the rest without running anything.

## The script runtime

- **No interactive input.** `prompt`, `alert` and `confirm` do nothing and return
  immediately. `kaja.askStr/askInt/askSelect` are how a script asks, and
  `kaja.approve()` how it holds a call back until someone says yes; all park the
  run on a human — only reach for one when a person is at the app.
- **A method hands back a `Call`, not a promise.** It is sent when you await it,
  so `await Shows.ListShows({})` is exactly what it always was. The gap is what
  lets `kaja.approve` hold a call back before it goes out.
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
  appends to it and hands back a row whose `.update(...cells)` rewrites it, and
  `.column(name)` adds a column. `rows` can be an array, or a source (an async
  generator) the table pulls a page at a time as it is paged through.
- `kaja.askStr(question)`, `kaja.askInt(question)`,
  `kaja.askSelect(question, options)` — ask the user for text, a whole number,
  or one of a list; each blocks on a human and hands back the kind of thing it
  asked for, so never ask for text and parse it yourself.
- `kaja.approve(call): Promise<T>` — hold a call until the user approves it, e.g.
  `await kaja.approve(Shows.CreateShow({ … }))`. The call goes inside the
  parentheses, and not approving stops the script. Blocks on a human.
- `kaja.variables.<name>` — the user's configured variables, resolved.
- `kaja.input?: string` — text supplied when the script is launched from the
  macOS "Run Kaja Script" text service. `undefined` when run any other way.
- `kaja.uuidV4(): string` — a random version 4 UUID.
- `kaja.value(json)`, `kaja.struct(json)`, `kaja.listValue(json)` — build a field
  typed `Value`, `Struct` or `ListValue`. Those hold **any** JSON, and their wire
  shape is a `kind` oneof you must never write by hand and never re-implement as
  your own `str`/`num`/`bool` helpers. The generated call `describe_method` gives
  you already uses the right builder; keep it and change the argument.

```ts
import { kaja } from "kaja";
import { Seating } from "seating/proto/seating";

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
