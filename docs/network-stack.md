# The network stack

Every call a script makes through an app starts as JavaScript and crosses a Go
process before it reaches an API. [AGENTS.md](../AGENTS.md) records the rules;
this is the picture: what carries a call on each build, what each hop adds and
removes, and what comes back out of band. [Seven traces](#seven-traces) below
walks one real call through each lane, hop by hop, on both builds.

The whole stack rests on two reserved channels, one in each direction:

- **`X-Kaja-App`** rides the request and names the app the call belongs to. The
  Go side takes it out, looks the app up in `kaja.json` at call time, expands
  `${NAME}` references and applies the app's credential — none of which the
  browser ever holds.
- **`kaja-upstream-*`** rides the response: the duration Kaja measured, the
  headers an app exchanged (redacted), and an HTTP failure shown in place of
  the gRPC status it was tunnelled through. The client routes the whole prefix
  onto the call (`absorbReserved`) and never shows it as a response header.

## Web

The UI runs in a browser; the kaja server on `:41520` is the one Go process in
every call's path. All three protocols go through `POST /target/…` — the
request's `Content-Type` and `X-Target` decide which lane it takes.

```
┌────────────────────────────── browser tab ──────────────────────────────┐
│  script ── Shows.ListShows({ pageSize: 25 })                            │
│    └─► protobuf-ts client   (gRPC-Web fetch, or Twirp fetch)            │
│          X-Target:            dns:host:443 · https://… · kaja-app://id  │
│          X-Header-X-Kaja-App: shows                                     │
│          X-Header-<name>:     <value — ${NAME} travels unexpanded>      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  POST /target/{pkg.Service/Method}
┌────────────────────────── kaja server :41520 ───────────────────────────┐
│  take X-Kaja-App ── read the app out of kaja.json at call time          │
│  expand ${NAME} ── merge the app's credential and TLS options           │
│                                                                         │
│  X-Target: kaja-app://…      │  gRPC-Web content   │  anything else     │
│  (openapi · mcp · openai ·   │  type               │  (twirp)           │
│   folder)                    │                     │                    │
│  ServeAppGRPCWeb             │  gRPC-Web ⇄ gRPC    │  reverse proxy,    │
│   └─► InvokeApp — stamps     │  proxy — one server │  /target/→/twirp/  │
│       duration, redacts      │  stream, framed out │  — stamps duration │
│   └─► app transcodes         │  a message at a     │                    │
│       proto3-JSON ⇄ REST/MCP │  time               │                    │
└──────────────┬───────────────┴──────────┬──────────┴─────────┬──────────┘
               │ HTTPS                    │ gRPC (HTTP/2)      │ HTTP POST
               ▼                          ▼                    ▼
          upstream API              upstream gRPC        upstream Twirp
```

The folder app is the one lane with no upstream arrow: its "exchange" is the
disk behind `os.Root`, and it forwards no headers.

Every call the gRPC lane forwards is opened as a server stream, because nothing
in a gRPC-Web request says which kind of method it names and a unary call is a
stream of one. The response goes back as **binary** gRPC-Web frames, flushed one
message at a time, whatever format the request arrived in — a `grpc-web-text`
body is one continuous base64 stream, so a frame that misses a group boundary
would hold its last bytes back until the next frame gave them company. The call
lives as long as the browser's request: no deadline of Kaja's own to cut a long
stream short, and an aborted fetch cancels the call upstream.

On the way back, everything Kaja has to say travels beside the response, never
inside it:

```
  gRPC-Web trailers          kaja-upstream-duration-ms
                             kaja-upstream-request-headers    (in-process apps,
                             kaja-upstream-response-headers    ${NAME} redacted)
                             kaja-upstream-error              (the HTTP failure,
                                                               shown instead of
                                                               the gRPC status)
                             <the gRPC server's own metadata> (the gRPC lane,
                                                               under its own names)
  Twirp response header      Kaja-Upstream-Duration-Ms
```

The gRPC lane is a bridge rather than a hop — the same call is forwarded — so
what the server answered with is the response's own headers and rides back
under its own names, on a refusal as well as a success, which is what the
Headers view shows as the API's own. Header and trailer metadata are read as
one; the names carrying the frame (`content-type`, `grpc-status`, anything
`-bin` or under `kaja-upstream-`) are dropped, so an upstream cannot write
into Kaja's own channel.

## Desktop

Same app, no HTTP tunnel: the webview and Go are one process, so the "wire" is
a Wails binding and the response is a `TargetResult` value.

```
┌──────────────────────────────── webview ────────────────────────────────┐
│  script ── Shows.ListShows({ pageSize: 25 })                            │
│    └─► WailsTransport ── Target(target, method, bytes, headersJson)     │
│          headersJson: the app's headers + X-Kaja-App,                   │
│                       ${NAME} still unexpanded                          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  Wails binding — same process
┌────────────────────────────── kaja (Go) ────────────────────────────────┐
│  TakeAppName · ExpandAll · MergeMetadata — the same doors as the web    │
│                                                                         │
│  kaja-app://…                │  gRPC               │  Twirp             │
│  InvokeApp → app             │  pkg/grpc client,   │  http.Client POST  │
│  (duration, redaction)       │  shared connection  │  <target>/twirp/…  │
└──────────────┬───────────────┴──────────┬──────────┴─────────┬──────────┘
               │ HTTPS                    │ gRPC (HTTP/2)      │ HTTP POST
               ▼                          ▼                    ▼
          upstream API              upstream gRPC        upstream Twirp

  back:  TargetResult { body, statusCode, requestHeaders,
                        responseHeaders, trailers, durationMs }
         — the transport mirrors it into the same kaja-upstream-* shape
  server streams:  Wails events  stream:<id> · :end(durationMs) · :error
```

## What never crosses which line

- **Credentials and `${NAME}` values stay in Go.** The JS side sends
  references; the Go side resolves them on the way out and redacts them out of
  what an app reports exchanging, so the Headers view shows `Bearer ${TOKEN}`.
- **`X-Kaja-App` never reaches an upstream.** Both routers remove it before
  anything is forwarded.
- **`kaja-upstream-*` never reads as the API's headers.** One boundary in
  `client.ts` consumes the prefix — an unknown key under it is dropped, not
  displayed.
- **The tunnel never shows through.** An upstream HTTP failure arrives as the
  HTTP failure it was; an upstream gRPC status crosses the web proxy as
  itself, not as a proxy 500.
- **Durations are stamped where the exchange happened.** Every Go hop measures
  its upstream call and the UI shows that number; only the run's wall time is
  the client's own clock.

## Seven traces

The diagrams above say what the lanes are. This says what one call *does*: hop
by hop, in each lane, the same journey twice — once per build. Five of the seven
are calls against the demo workspace ([`workspace/kaja.json`](../workspace/kaja.json))
and can be pressed Run on as they are written; the demo workspace has no folder
app, and a bare `fetch` belongs to no app at all.

Three families, and the family is what decides the trace:

| family | apps | who talks to the API |
| --- | --- | --- |
| forwarded | `grpc` · `twirp` | the Go side forwards the browser's own call |
| in-process | `openapi` · `mcp` · `openai` · `folder` | the Go side *makes* the call |
| neither | the Api service · a bare `fetch` | nobody, or the page itself |

### 1. A gRPC app call

```ts
import { Seating } from "seating/proto/seating";
const { seatMap } = await Seating.GetSeatMap({ showId: "apollo-13@the-lantern" });
```

`seating` is `dns:seating.kaja.tools:443` by reflection, so the method path is
`seating.Seating/GetSeatMap`.

**Web**

1. `client.ts` merges the app's configured headers with this call's
   (`mergeHeaders`) and adds `X-Kaja-App: seating`. Each one goes onto the call's
   metadata as `X-Header-<name>`, alongside `X-Target: dns:seating.kaja.tools:443`.
2. `GrpcWebFetchTransport`, based at `/target`, sends
   `POST http://localhost:41520/target/seating.Seating/GetSeatMap`,
   `Content-Type: application/grpc-web-text`, body one base64'd length-prefixed frame.
3. `/target/{method...}` collects the `X-Header-*` back into a map and
   `apps.TakeAppName` lifts `seating` out of it.
4. Not a `kaja-app://` target, so: `Variables().ExpandAll` resolves the `${NAME}`
   references the browser sent unexpanded, `AppConnection("seating")` reads the app
   out of `kaja.json` **now** and hands back its credential and TLS options, and
   `apps.MergeMetadata` applies the credential without displacing a header the app
   configures under the same name.
5. Content type says gRPC-Web, so `grpc.NewProxy(target, connection.TLS)` and
   `OpenServerStream(r.Context(), …)` — every call, unary or not, because nothing in
   the request says which kind it names.
6. **Wire:** gRPC over HTTP/2 and TLS to `seating.kaja.tools:443`, method
   `/seating.Seating/GetSeatMap`. No deadline of Kaja's own: the call lives as long
   as the browser's request, which is what carries Stop through.
7. Back: each message as a **binary** `application/grpc-web+proto` frame, flushed
   as it arrives; then a trailer frame with `grpc-status`, the server's own metadata
   under its own names, and `kaja-upstream-duration-ms`.
8. `collectResponseHeaders` → `absorbReserved` eats the `kaja-upstream-` prefix;
   everything else becomes the call's response headers, which is what the Headers
   view shows and what `call.withHeaders()` hands back.

**Desktop**

1. Same merge in `client.ts`. No `X-Target` — `WailsTransport` in `target` mode
   holds the `appRef` and reads the target off it.
2. `app.Target("dns:seating.kaja.tools:443", "seating.Seating/GetSeatMap", <base64>, 1, headersJson)`
   — a Wails binding, same process, the `[]byte` crossing as base64.
3. `desktop/main.go`'s `Target` walks the same four doors as the web handler:
   `TakeAppName` · `ExpandAll` · `AppConnection` · `MergeMetadata`.
4. Protocol 1 → `targetGRPC` → `grpc.NewClientFromString(target, options)` (the
   connection cache is keyed on the target **and** the options) →
   `InvokeWithTimeout(method, req, 30s, headers)`.
5. **Wire:** identical to step 6 above — except for that 30 second deadline, which
   the web lane has no counterpart for.
6. Back as a `TargetResult{ body, trailers, durationMs }`; `wails-transport.ts`
   mirrors it into the same `kaja-upstream-*` metadata shape, so step 8 above is
   byte-for-byte the same code.

A server stream takes `TargetServerStream` instead, and comes back as the Wails
events `stream:<id>` · `:end(durationMs)` · `:error` — which is why a desktop
server stream reports a duration and no headers.

### 2. A Twirp app call

```ts
import { Quirks } from "quirks/v1/quirks";
const { result } = await Quirks.Sum({ a: "2", b: "3" });
```

`quirks` is `https://quirks.kaja.tools` with two configured headers
(`X-Yolo: kaja123`, `Authorization: Bear brown`); the method path is
`quirks.v1.Quirks/Sum`.

**Web**

1. Same merge and same `X-Header-*` / `X-Target` metadata as trace 1.
2. `TwirpFetchTransport` based at `/target` sends
   `POST http://localhost:41520/target/quirks.v1.Quirks/Sum`.
3. `/target/{method...}`: `TakeAppName` · `ExpandAll` · `AppConnection` ·
   `MergeMetadata`, exactly as above.
4. Content type is not gRPC-Web, so a `httputil.NewSingleHostReverseProxy` whose
   director rewrites `/target/` → `/twirp/` and re-hosts the URL:
   **`POST https://quirks.kaja.tools/twirp/quirks.v1.Quirks/Sum`**, with the merged
   headers `Set` on it.
5. Back: the upstream response passes through as itself, with
   `Kaja-Upstream-Duration-Ms` added by `ModifyResponse` — Twirp has no trailers, so
   the measurement rides a reserved *header* in the same namespace.

**Desktop**

1. `app.Target("https://quirks.kaja.tools", "quirks.v1.Quirks/Sum", <base64>, 2, headersJson)`.
2. The same four doors, then protocol 2 → `targetTwirp`, which builds
   `https://quirks.kaja.tools/twirp/quirks.v1.Quirks/Sum` by hand, sets
   `Content-Type: application/protobuf` and the merged headers, and posts it with a
   plain `http.Client`.
3. Back as `TargetResult{ body, statusCode, status, durationMs }` — and **no
   headers**: this is the one lane where the desktop reports less than the web, so
   `call.withHeaders()` comes back empty on a desktop Twirp call. A `statusCode`
   of 400 or more is thrown as an `UpstreamError` carrying the Twirp error body.

### 3. An internal API call

```ts
const { response } = await getApiClient().getConfiguration({});
```

Nothing here is an app: no `X-Kaja-App`, no `X-Target`, no `X-Header-*`, no
`kaja-upstream-*`, and no upstream. `api.proto` declares no package, so the Twirp
path is `/twirp/Api/GetConfiguration` on both builds.

**Web**

1. `getApiClient()` → `TwirpFetchTransport` based at
   `http://localhost:41520/twirp`.
2. `POST http://localhost:41520/twirp/Api/GetConfiguration`.
3. The generated Twirp handler → `ApiService.GetConfiguration`: read
   `../workspace/kaja.json`, migrate it, resolve each variable against the
   environment alone (the web server binds **no** `VariableStore`, so a `${secret}`
   falls to `KAJA_<NAME>`), and build the `Runtime` beside it —
   `can_update_configuration` is the `--editable` flag.
4. Protobuf back over the same connection. It never left the machine the server is
   on.

**Desktop**

1. `WailsTransport` in `api` mode → `app.Twirp("GetConfiguration", <base64>)`.
2. `desktop/main.go`'s `Twirp` builds an `http.Request` for
   `/twirp/Api/GetConfiguration` and serves it into an `httptest.NewRecorder()`
   against the same generated handler — an HTTP round trip with no socket under it.
3. The same `ApiService`, but constructed **with** a `VariableStore`, so a value can
   resolve `KEYCHAIN` and `variable_store_available` can be true.
4. A non-200 comes back as the recorder's Twirp error JSON, thrown as the binding's
   error; `apiError` in the transport parses it back into the same `RpcError` the
   browser's fetch arrives at.

### 4. An OpenAPI app call

```ts
import { Theatre } from "theatre/service";
const page = await Theatre.ListShows({ city: "Chicago", theaterId: "", movieId: "", limit: 25, cursor: "" });
```

`theatre` reads `https://theatre.kaja.tools/openapi.yaml`, whose title is
*Theatre* and whose operations carry no tags — so the generated package is
`openapi.theatre`, the service is the title-named default, and the method path is
`openapi.theatre.Theatre/ListShows`. Opening the app minted a target like
`kaja-app://9f3c1d…` (16 random bytes, hex).

**Web**

1. `client.ts` adds `X-Kaja-App: theatre`; `X-Target: kaja-app://9f3c1d…`.
2. `POST http://localhost:41520/target/openapi.theatre.Theatre/ListShows`,
   `application/grpc-web-text`.
3. `/target/{method...}`: `TakeAppName`, then `apps.IsAppTarget` is true — so the
   proxying branch is never reached. `grpc.ServeAppGRPCWeb` reads the one gRPC-Web
   frame out of the body and calls `apiService.InvokeApp`.
4. `InvokeApp`: `ExpandAll` the headers, start the clock, `Manager.Invoke` routes
   `9f3c1d…` to the live openapi instance.
5. The instance: protobuf → `protojson` → `transcode`. Path template `/shows`, the
   fields the binding marked as query parameters become the query string, the spec's
   own `securitySchemes` are applied first, then the app's configured headers, then
   any per-call header parameter, then `Accept: application/json` if nothing set one.
6. **Wire, made by the Go process:**
   `GET https://theatre.kaja.tools/shows?city=Chicago&limit=25`.
7. The JSON response → `protojson` into `ListShowsResponse`, strict first and then
   with the members it can't read pruned out (`pruneMismatched`) → protobuf bytes.
8. Back in `InvokeApp`: stamp `DurationMs`, and `Redact` the resolved `${NAME}`
   values back out of what the app reports having sent.
9. `ServeAppGRPCWeb` writes one message frame plus trailers —
   `kaja-upstream-duration-ms`, `kaja-upstream-request-headers`,
   `kaja-upstream-response-headers`, each a JSON object.
10. `absorbReserved` routes all of it onto the call. The Headers view therefore
    shows the **theatre.kaja.tools** exchange, not the browser-to-Kaja hop, and with
    `Bearer ${TOKEN}` where a variable stood.

An upstream `>= 400` is an `apps.UpstreamError` instead: the whole failure rides
in a `kaja-upstream-error` trailer and the frame's `grpc-status` is only the
closest mapping, for the benefit of a plain gRPC-Web client.

**Desktop**

Steps 4–8 are the same code. Only the way in and the way out differ:

1. `app.Target("kaja-app://9f3c1d…", "openapi.theatre.Theatre/ListShows", <base64>, 1, headersJson)`
   — the protocol argument is ignored on this branch.
2. `apps.IsAppTarget` → `a.api.InvokeApp(…)`, the same `ApiService` method the web
   handler calls.
3. Back as `TargetResult{ body, requestHeaders, responseHeaders, durationMs }`,
   which the transport mirrors into the same trailers. A failure becomes
   `Body: upstream.JSON()` with `StatusCode: 502` — Kaja failing as the gateway it
   is here, the upstream's own status travelling inside the JSON.

So on **both** builds `theatre.kaja.tools` is talked to by Go, and the browser
never opens a connection to it. That is the whole difference between this family
and traces 1–2.

### 5. An MCP app call

```ts
import { Tools as Concierge } from "concierge/mcp";
const suggestion = await Concierge.SuggestFilm({ mood: "something loud", party: 2, city: "Chicago", maxMinutes: 0 });
```

The generated package is always `mcp`, and a tool becomes a method of a `Tools`
service — so the server's own `suggest_film` is `mcp.Tools/SuggestFilm`, and the
target is another `kaja-app://…`. Hops 1–4 and 8–10 are trace 4's, unchanged.
What differs is the middle:

5. The instance decodes the protobuf into the arguments object it stands for —
   every field carries the tool property's own name as its `json_name`, so the
   message **is** the arguments, with no mapping table — and wraps it as
   `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"suggest_film","arguments":{…}}}`.
6. **Wire:** `POST https://concierge.kaja.tools/mcp`,
   `Content-Type: application/json`,
   `Accept: application/json, text/event-stream`, `MCP-Protocol-Version`, and then
   whichever pair the era calls for — a modern server gets `Mcp-Method: tools/call`
   and `Mcp-Name: suggest_film`, mirroring the routed fields so an intermediary need
   not parse the body; a handshake-era one gets its `Mcp-Session-Id` instead. Which
   era it is was settled **once**, by a `server/discover` probe.
7. The answer is a JSON object, or an SSE stream whose last data event is the
   response (notifications sent ahead of it are stepped over) → `content` +
   `isError` + `structuredContent` → protobuf. A tool reporting `isError: true`
   comes back as an ordinary response, not a failure.

Desktop is trace 4's desktop: the door changes, hops 5–7 do not.

### 6. A folder app call

```ts
import { Folder } from "<app>/folder";
const { content } = await Folder.ReadFile({ file: "team/notes.md" });
```

The proto surface is static, so the method path is `folder.Folder/ReadFile`
whatever the app is called, and the target is another `kaja-app://…`. Hops 1–4
are trace 4's.

5. **There is no wire.** `resolve` runs `filepath.IsLocal` as a lexical check and
   then opens through an `os.Root` rooted at the app's `path` — the syscall-level
   boundary, symlinks included. `makeParents` creates the folders a write implies.
6. Nothing is forwarded and nothing is exchanged, so `InvokeResult` carries no
   request or response headers and the trailers hold the duration alone. The
   Headers view has nothing to show, correctly.

The one thing this trace changes between builds is **whose disk**: on the desktop
it is yours (on the sandboxed macOS build, reached through a security-scoped
bookmark saved when you picked the folder), and on the web it is the **server's**,
which is why a deployed kaja's folder app is a container's filesystem and not the
reader's.

### 7. A bare `fetch` in a script

```ts
const res = await fetch("https://api.example.com/v1/things", {
  headers: { Authorization: `Bearer ${kaja.variables.TOKEN}` },
});
```

This one is the odd trace, and worth having written down precisely because it
looks like the others.

**Web**

1. `runScript` transpiles the file and hands the body to `new Function`, so it runs
   in the page with the page's own globals — `fetch` among them.
2. The request goes **from the browser straight to `api.example.com`**. There is no
   Kaja process in its path on either end.
3. Which means: no `X-Kaja-App`, so no credential lookup and no `${NAME}`
   expansion; CORS is the API's to allow, from the origin kaja is served on; no log
   row, no duration, no payload pane, nothing on the canvas. And `kaja.variables` on
   the web is the **configuration's own text**, so `kaja.variables.TOKEN` reads back
   the literal `${secret}` rather than a value.

**Desktop**

1. Same `new Function`, the webview's own `fetch`, leaving the webview process
   directly. Kaja's Go side is not in the path here either.
2. `kaja.variables` **is** resolved: the UI runs inside the app's own process, so
   `App.tsx` fills it from the desktop-only `ResolvedVariables` binding. A keychain
   value is readable by a script, which is the one place in kaja where that is true.
3. Everything in point 3 above still holds: no row, no duration, no redaction, and
   the page's origin is whatever the Wails asset handler serves it under.

Use it for the thing a script genuinely needs and no app models — a webhook, a
one-off `GET` of a text file. Anything you want to *see* belongs in an app, because
the console only knows about calls that went through a client.
