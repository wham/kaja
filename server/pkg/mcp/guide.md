# Kaja for agents

Kaja is a client for APIs — gRPC, Twirp, OpenAPI and MCP services the user has
configured as **apps**, or that you add for them. Every app exposes **services** with **methods**, and a
**script** is a TypeScript file that calls them. This MCP server lets you read
and run those scripts, and — where Kaja owns the workspace it opened — write
them. `tools/list` is what says which: a Kaja serving a workspace it does not own
lists no tool that writes a file.

## The loop

1. `list_services` — the index of what is callable, one TypeScript signature per
   method. Filter with `app`, `service` or `search` on a large API.
2. `describe_method "Issues.ListForRepo"` — the declarations of every type that
   method's signature names, whether the call reads or writes, and a call to
   start from, carrying the required fields alone. `describe_type "Issue"` looks
   one type up on its own, and `describe_type "kaja"` is the runtime a script
   writes its output with.
3. `run_script` with `code` to try it, then `create_script` to keep it — where
   there is one.

**Everything you are shown is TypeScript**, because that is all a script is: the
declarations come out of the generated code your script is checked against, so
there is nothing else to go and read.

## Adding an app

An API that is not an app yet can become one from here, where Kaja owns the
workspace. `inspect_api` probes it and says what adding it would need, writing
nothing; `add_app` adds it. Both take the app as kaja.json spells it: a `type`
(`grpc`, `twirp`, `openapi`, `openai`, `mcp`, `folder`) and its `parameters`
under that key, every value a string, so what you write is what the file says.

`add_app` probes first. When the address answers with its surface and nothing is
missing, the app is written at once and its services are listed back, so the
next call is a method call. When something is missing — a credential, a proto
folder, which of several servers a document names — Kaja opens **its own New
app form** in front of the user, prefilled with what you gave. Each call waits
a few seconds, then answers that the form is still open. Tell the user once what
to fill in, then **call `add_app` again with the same name without ending your
turn**, and keep calling: each call answers the moment they save or close the
form — with the app's services, or that they closed it — and none opens a second
form. So you carry on as soon as they are done, without them coming back to say
so. If the form stays open long enough that they have likely walked away, the
answer says to stop; then end your turn, and call again when they say it is done.

**Read up on an API you don't know before you add it.** Its documentation says
what the person will have to supply and where it differs from the obvious: an
address that is different for every tenant or region, an API key that is sent as
the basic-auth username with an empty password, where in the product a key is
made and what it can reach. Say it in `hints`, keyed by the same field names as
`parameters` (`"base_url": "Your tenant's address, https://<tenant>.example.com/api/v1"`),
and anything about the app as a whole in `note`. The form shows both while the
user fills it in, which is where they need them; the chat is not.

What is not a secret is yours to ask for before you call: which tenant, region
or server a document's address leaves open. A form with only the credential left
in it is one the user finishes in a moment.

**Never ask the user for a token or a password yourself**, and never write one
into a parameter you were not given. Where the user keeps one as a variable,
name it: `"token": "${GITHUB_TOKEN}"` is resolved where the app opens and never
passes through you. Where they don't, leave it out — the form is where it is
typed, and it never reaches the transcript.

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
on disk renaming and moving are one operation. `rename_folder` renames a folder
with everything in it, which is one step where renaming its scripts one by one is
many. `list_scripts` reports the folder each script is filed in. File a script where a person would look for it rather
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
import { Issues, Repos } from "github";

const about = await Repos.Get({ owner: "wham", repo: "kaja" });
const { items: issues } = await Issues.ListForRepo({ owner: "wham", repo: "kaja", state: "open", perPage: 5 });
kaja.text(`${about.fullName} has ${about.openIssuesCount} open issues. Newest: ${issues.map((issue) => `#${issue.number}`).join(", ")}`);
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
import { Issues } from "github";

const issues = kaja.pages((page) => Issues.ListForRepo({ owner: "wham", repo: "kaja", perPage: 50, page }), { page: 1 });

kaja.table(issues, (issue) => ({
  number: issue.number,
  title: issue.title,
  author: issue.user?.login,
  opened: issue.createdAt,
}));
```

**Say what the script reads first, then what it shows.** The first line is the
call; the table is handed those rows and a function turning each one into a row,
whose **keys are the columns** — so a header sits beside its value rather than
being matched to it by position. A key is a column's name as the person reads it,
so write `"last seen": user.lastSeen`, not `lastSeen`. Where the fields are worth
showing as they are, name them instead: `kaja.table(issues, ["number", "title"])`.
Pass a timestamp as the API sent it — the table draws an instant as how long ago
it was — rather than formatting it yourself.

**`kaja.pages` is how a paged method is read**, and the table pages and
searches it for the person who opens the script, a page at a time, without
running anything. Write the call as a function of where the page starts and
nothing else: the items, the next cursor and the total are read off the page,
and where a page can't say (two lists, or a cursor under another name) the
editor asks for `items` or `next` rather than guessing. A list paged by number
says where it starts, as `{ page: 1 }` does above, and the call is handed the
number; `{ offset: 0 }` pages by offset, and a list paged by cursor takes no
second argument and is handed the cursor the last page named. Never write the
paging loop yourself. A source that is a function of the search text is
restarted for each search:

```ts
kaja.table(
  (search) => kaja.pages((page) => Search.Repos({ q: search, perPage: 50, page }), { page: 1 }),
  (repository) => ({ repo: repository.fullName, stars: repository.stargazersCount }),
  { title: "Repositories" },
);
```

`run_script` reports what you drew — each block's kind, and a table's columns
and row count — so you can check the output landed.

**A table filled by the run is a handle.** `kaja.table()` with no rows hands one
back; `.row({ … })` draws a row and hands back a handle of its own, and
`.update({ … })` rewrites the columns it names and leaves the rest. That is how a
summary table is built: write the row when the work starts and update it when it
finishes, rather than waiting until the end and drawing the table once.

```ts
const table = kaja.table({ title: "Latest releases" });
await Promise.all(
  ["wham/kaja", "torvalds/linux"].map(async (name) => {
    const [owner, repo] = name.split("/");
    const row = table.row({ repo: name, release: "checking…" });
    const { items: releases } = await Repos.ListReleases({ owner, repo, perPage: 1 });
    row.update({ release: releases[0]?.tagName ?? "none", published: releases[0]?.publishedAt });
  }),
);
```

**Everything else about a table is in `describe_type "kaja"`** — `kaja.pages`'s
`items`, `next` and `total`, `.total(count)` for a source that isn't a
`kaja.pages`, what declaring that `search` parameter does and what happens
without it, a cell handed over as a promise or a function, how a failed one
draws, and `kaja.run(...)` for a cell that runs another script. That declaration
is the TypeScript the editor checks a script against, so it cannot be out of
date with the runtime; read it there rather than working from what you remember
of this page.

Two things about a table are this page's rather than the declaration's:

- **Nobody is paging your run.** A source draws its first page and `run_script`
  reports `more: true`; a function cell past that page is never called in your
  run. Use a promise rather than a function for a value that has to be in the
  run you are reporting, and `for await (const issue of kaja.pages(…))` if you need
  the whole set.
- **`kaja.run(...)` runs nothing in your run.** It is the action a row invites,
  for the person reading the table.

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
  ({ iteration }) => HelloService.SayHello({ greeting: `call ${iteration}` }),
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

- **No interactive input.** `prompt`, `alert` and `confirm` are refused (see the
  globals below). `kaja.askStr/askInt/askSelect` are how a script asks, and
  `kaja.approve()` how it holds a call back until someone says yes; all park the
  run on a human — only reach for one when a person is at the app.
- **A method hands back a `Call`, not a promise.** It is sent when you await it,
  so `await Repos.Get({ owner, repo })` is exactly what it always was. The gap is what
  lets `kaja.approve` hold a call back before it goes out.
- **Headers are the call's, both ways.** A second argument sends them, over the
  ones the app is configured with and matched by name whatever the case. The app's
  own headers and credential go out without a script saying anything — write one
  here only where this call needs it.
- **`withHeaders()` is how the answer's headers are read**, and the only way:
  awaiting a call still hands back the response alone, so nothing about the
  ordinary call changes. Header names are lowercase.

  ```ts
  const { response, headers } = await Issues.Create(
    { owner: "wham", repo: "kaja", title: "Flaky test on main" },
    { headers: { "X-GitHub-Api-Version": "2022-11-28" } },
  ).withHeaders();
  kaja.text(`Opened #${response.number}, ${headers["x-ratelimit-remaining"]} calls left this hour.`);
  ```
- **Server streaming is called like any other method**, and hands back the last
  message; all of them are in the run's log. **Client and bidirectional streaming
  are not supported by Kaja yet** — `list_services` marks such a method, and
  calling it is refused whatever the request.
- **Top-level `await` works**: the body runs inside an `async` function.
- **`fetch` is how a script reaches an API that isn't an app** — see below.
- There is no DOM and no file system. What a script reaches, it reaches through
  the apps in `list_services` and through `fetch`.
- The `kaja` object is imported with `import { kaja } from "kaja";`.

## The globals

A script has the globals it would have anywhere, and the two it uses most are the
run's: **`console`**, whose lines come back to you in the run report, and
**`fetch`**, whose requests are rows in the run's log like an app's calls. Both
are the standard API under the standard name, and Kaja has no second spelling of
either — there is no `kaja.log` and no `kaja.fetch`. Write them as you would
anywhere; being the run's is what Kaja adds, and it changes nothing you write.

`crypto.randomUUID()` works here too, which it does not in every page Kaja runs
in — the desktop's webview and a kaja served over plain http are not secure
contexts, so the page's own `crypto` carries no `randomUUID`. `kaja.uuidV4()` is
the same function under Kaja's own name.

A handful of globals cannot work where a script runs, and each is bound to
something that throws a sentence naming what to reach for instead — so a script
that reaches for one is told at the line that reached, rather than failing
somewhere further on:

| Refused | Why, and what instead |
| --- | --- |
| `prompt`, `alert`, `confirm` | They do nothing, and nobody may be watching the window. Ask with `kaja.askStr`/`askInt`/`askSelect`, draw with `kaja.text`. |
| `XMLHttpRequest` | A request made with it goes unrecorded. Use `fetch`. |
| `WebSocket`, `EventSource` | Not supported: a run is a script that ends, and there is nowhere to draw a connection that outlives it. |
| `localStorage`, `sessionStorage`, `indexedDB` | They are Kaja's own, and the desktop's page has none. A run keeps nothing of its own. |
| `document`, `window` | The page is Kaja's own window. A script draws with `kaja.text`, `kaja.code` and `kaja.table`. |
| `require`, `process` | A script runs in a browser, not in Node. An import names an app; the variables are `kaja.variables`. |

This is a signpost rather than a fence — it is there so a script that reached for
the wrong thing is told which thing to reach for.

## The `kaja` object

**`describe_type "kaja"` returns its full declaration** — the TypeScript the
editor itself is checked against, with this workspace's own variable names in it.
What each member is for:

- `kaja.text(text)`, `kaja.code(code, language?)` — draw a line or a snippet on
  the canvas.
- `kaja.table(rows, columns?, options?)` — draw a table: each item turned into a
  row by `columns`, whose keys are the column names. Without rows it hands back a
  handle that rows are added to and rewritten through; a cell can be a promise the
  table waits for, and rows handed over as a source are paged and searched by the
  table itself. `options.title` heads it. See above, and the declaration.
- `kaja.pages(fetch, options?)` — a paged list method, by cursor, page number or
  offset, as the items it lists, fetched a page at a time as they are read.
- `kaja.run(script, input?, options?)` — a cell that runs another script with those
  values when it is clicked. The script is named as a deeplink names one, the cell
  says its column's name unless `options.label` says otherwise, and the values are
  read there as `kaja.input.<key>`.
- `kaja.perfTest(body, options)` — run a body on a schedule and let the run's
  Stats page report it. The numbers are drawn for you; the report it hands back
  is for judging them. See above.
- `kaja.askStr(question)`, `kaja.askInt(question)`,
  `kaja.askSelect(question, options)` — ask the user for text, a whole number,
  or one of a list; each blocks on a human and hands back the kind of thing it
  asked for, so never ask for text and parse it yourself.
- `kaja.approve(call): Promise<T>` — hold a call until the user approves it, e.g.
  `await kaja.approve(Issues.Create({ owner, repo, title }))`. The call goes inside the
  parentheses, and not approving stops the script. Blocks on a human — though
  they can press **Approve all**, which settles every later call to the same
  method in that run without asking again. So wrapping each call of a loop is
  right: the reader decides where to stop reading, not the script.
- `kaja.variables.<name>` — the user's configured variables, resolved.
- `kaja.input` — what a `kaja://run/<script>?url=…&note=…` link handed this run,
  read by name (`kaja.input.url`). Every value is text, and the whole query
  belongs to the script. Run repeats what the file last ran with, so a parameter
  nothing has ever carried is undefined: guard it (`kaja.input.url ?? ""`) or ask
  for it with `kaja.askStr` and the script works from a link and from the editor
  alike.
- `kaja.uuidV4(): string` — a random version 4 UUID. `crypto.randomUUID()` is the
  same function.
- `kaja.value(json)`, `kaja.struct(json)`, `kaja.listValue(json)` — build a field
  typed `Value`, `Struct` or `ListValue`. Those hold **any** JSON, and their wire
  shape is a `kind` oneof you must never write by hand and never re-implement as
  your own `str`/`num`/`bool` helpers. Where the call `describe_method` gives you
  already fills one in, keep the builder and change the argument.

```ts
import { kaja } from "kaja";
import { Actions } from "github";

await Actions.CreateWorkflowDispatch({
  owner: "wham",
  repo: "kaja",
  workflowId: kaja.value("deploy.yml"),
  ref: "main",
  inputs: kaja.struct({ environment: "staging", regions: ["us", "eu"], dryRun: true }),
});
```

## An API that isn't an app

Not everything worth calling is configured. A webhook, a health check, an API
nobody has added — those are reached with **`fetch`**, which is the standard one:
inside a script the bare name is bound to Kaja's own, so there is nothing new to
learn and nothing else to write.

```ts
const response = await fetch("https://api.example.com/status", {
  headers: { Authorization: `Bearer ${kaja.variables.TOKEN}` },
});
const status = await response.json();
```

Being Kaja's makes it a call like any other: a row in the run's log named
`GET api.example.com`, with the request, the response and the headers under it, a
share of the run's stats, and something the runtime's verbs work on.

```ts
await kaja.approve(fetch(url, { method: "DELETE" }));
kaja.rateLimit("api.example.com", { perSecond: 5 });
```

A rate limit is named by the host, because that is what a fetch has instead of an
app.

**Prefer an app's method wherever there is one.** It is typed, its credential is
already configured, and `describe_method` will show you the request. Three things
follow from a fetch being the standard one rather than a call Kaja carries:

- a `${NAME}` in a header is not resolved for you — read the value out of
  `kaja.variables` and pass it, as above;
- in a browser the request is the page's own, so an API that sends no CORS headers
  cannot be reached this way and an app is what that call needs. The desktop makes
  it from its own process, where that limit does not apply;
- it throws what `fetch` throws. A request that never completed is an error; an
  HTTP status is not — a 404 is a response with `ok` false, and the log reports it
  as the failure it is either way.

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
- `UNSUPPORTED` — Kaja does not support this kind of method yet and refused the
  call before it went anywhere. `list_services` marks it `not supported yet`, and
  no request will change it.
