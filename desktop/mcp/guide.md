# Kaja for agents

Kaja is a desktop client for APIs — gRPC, Twirp and OpenAPI services the user has
configured as **apps**. Every app exposes **services** with **methods**, and a
**script** is a TypeScript file that calls them. This MCP server lets you read,
write and run those scripts.

## The loop

1. `list_services` — the index of what is callable. Filter with `app`, `service`
   or `search` on a large API.
2. `describe_method "Shows.ListShows"` — the request type with everything it
   reaches inlined, the response type, which fields are required, whether the
   call reads or writes, and an example that runs as written.
3. `run_script` with `code` to try it, then `create_script` to keep it.

Those two tools answer everything. The generated `.ts` stubs are offered as
resources for the rare case where you want the literal declarations; you should
not need them, and they are large.

## Read or write

Every method in `list_services` is marked `read` or `write`. A `?` means it was
inferred from the method name because the API doesn't state it; without a `?` the
HTTP verb behind the method settled it. **Treat `write` as a real side effect** —
confirm with the user before running one you were not asked for.

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
- **Send only the fields you mean.** This is proto3: nothing is required unless
  `describe_method` says the API declared it, and an omitted field is its zero
  value, not an error. Filling every parameter with `""` and `0` sends those
  values.
- A rejected call **throws**, which stops the script there. The calls it already
  made are still reported. Wrap a call in `try`/`catch` to keep going.

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
- `kaja.value(json)`, `kaja.struct(json)`, `kaja.listValue(json)` — build
  `google.protobuf.Value`, `Struct` and `ListValue` from plain JSON. A field of
  one of those types accepts **any** JSON, and its wire shape is a `kind` oneof
  that you must never write by hand — and never re-implement as your own
  `str`/`num`/`bool` helpers. `describe_method` names the builder on every field
  that needs one.

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
