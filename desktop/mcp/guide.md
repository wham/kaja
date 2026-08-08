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
   start from. `describe_type "Show"` looks one type up on its own.
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

## The script runtime

- **No interactive input.** `prompt`, `alert` and `confirm` do nothing and return
  immediately. `kaja.ask()` opens a real dialog — only use it when a person is at
  the app; over MCP it blocks on a human.
- **Top-level `await` works**: the body runs inside an `async` function.
- `console.log(...)` is the output channel; it is returned to you by
  `run_script`, along with every RPC the script made.
- `crypto.randomUUID()` is available, as is `kaja.uuid.v4()`.
- The `kaja` object is imported with `import { kaja } from "kaja";`.

## The `kaja` object

- `kaja.variables.<name>` — the user's configured variables, resolved.
- `kaja.input?: string` — text supplied when the script is launched from the
  macOS "Run Kaja Script" text service. `undefined` when run any other way.
- `kaja.uuid.v4(): string` — a random version 4 UUID.
- `kaja.ask(message): Promise<string>` — ask the user; blocks on a human.
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
