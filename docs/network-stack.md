# The network stack

Every call a script makes through an app starts as JavaScript and crosses a Go
process before it reaches an API. [AGENTS.md](../AGENTS.md) records the rules;
this is the picture: what carries a call, what each hop adds and removes, and
what comes back out of band. [Seven traces](#seven-traces) below walks one real
call through each lane, hop by hop.

**The client speaks gRPC-Web and nothing else.** Which protocol reaches an API is
this process's business, so there is one browser transport, one framing and one
out-of-band channel however an app talks upstream — and one set of doors, which
[the desktop mounts](#the-desktop-mounts-the-same-mux) rather than reimplements.

The whole stack rests on two reserved channels, one in each direction:

- **`X-Kaja-App`** rides the request and names the app the call belongs to. The
  Go side takes it out, looks the app up in `kaja.json` at call time, expands
  `${NAME}` references and applies the app's credential — none of which the
  browser ever holds.
- **`kaja-upstream`** rides the response, one trailer holding one object: the
  duration Kaja measured, the headers an app exchanged (redacted), and an HTTP
  failure shown in place of the gRPC status it was tunnelled through. The client
  routes it onto the call (`absorbReserved`) and never shows it as a response
  header.

## The one lane

The UI runs in a page — a browser tab against the kaja server on `:41520`, or
the desktop's webview against `wails://localhost`. Either way one Go process is
in every call's path and the page fetches `POST /app/…` on its own origin as
gRPC-Web. The app the call belongs to is the only address there is: it is named
by `X-Kaja-App`, and what the process does with the call is that app's business
rather than something the page is told.

```
┌─────────────── browser tab · desktop webview ───────────────────────────┐
│  script ── Shows.ListShows({ pageSize: 25 })                            │
│    └─► protobuf-ts client   (gRPC-Web fetch)                            │
│          X-Header-X-Kaja-App: shows                                     │
│          X-Header-<name>:     <value — ${NAME} travels unexpanded>      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  POST /app/{pkg.Service/Method}
┌──────────────────────────── kaja (Go) ──────────────────────────────────┐
│  grpc.Serve — de-frame the request, invoke, frame out however many       │
│              messages come back, one at a time                          │
│   └─► InvokeApp: take X-Kaja-App ── read the app out of kaja.json now   │
│                  expand ${NAME} ── merge its credential and TLS         │
│                  time the call, redact what comes back                  │
│        └─► Manager.Invoke(name) ─► the app's Instance ─► a Stream       │
│                                                                         │
│   openapi · twirp · mcp · openai · folder  │  grpc                      │
│   transcode here, or post the same bytes   │  forward the call as a     │
│   on (twirp) — a stream of one             │  server stream             │
└──────────────────────┬─────────────────────┴─────────────┬──────────────┘
                       │ HTTPS / HTTP POST                 │ gRPC (HTTP/2)
                       ▼                                   ▼
                  upstream API                       upstream gRPC
```

**The two families are "who talks to the API", not two lanes.** A gRPC call is
*forwarded* — the request the browser framed is the request the server gets, which is
what carries a server stream through. Everything else is transcoded here, from
openapi's REST mapping down to twirp, whose whole job is to post the same protobuf
bytes at `<url>/twirp/<method>`. Both are an `apps.Instance` answering with a
`Stream`, because a unary method is the stream that stops after one message: there is
nothing left for a handler to branch on.

The folder app is the one instance with no upstream arrow: its "exchange" is the
disk behind `os.Root`, and it forwards no headers.

Every call the grpc app forwards is opened as a server stream, because nothing
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
  gRPC-Web trailers          kaja-upstream  {                 (one object:
                               durationMs                      what Kaja
                               requestHeaders                  measured and
                               responseHeaders                 exchanged,
                               error                           ${NAME} redacted,
                             }                                 the HTTP failure
                                                               shown instead of
                                                               the gRPC status)
                             <the gRPC server's own metadata> (a forwarded call,
                                                               under its own names)
```

One carrier, because there is one framing: a Twirp call is answered in gRPC-Web
trailers like everything else rather than in a response header of its own. And
one name, because a trailer block is escaped, budgeted and parsed per name —
four keys bought nothing four fields of one object don't. A report too big for
the block is written again without the two header sets, so the failure itself
still gets through.

A forwarded call is a bridge rather than a hop — the same call is forwarded — so
what the server answered with is the response's own headers and rides back
under its own names, on a refusal as well as a success, which is what the
Headers view shows as the API's own. Header and trailer metadata are read as
one; the names carrying the frame (`content-type`, `grpc-status`, anything
`-bin` or `kaja-upstream`) are dropped, so an upstream cannot write
into Kaja's own channel.

## The desktop mounts the same mux

Nothing about a call is different there. `webviewHandler` in `desktop/main.go`
registers the two lanes with the same `router.Mount` the server calls and hands
the mux to Wails, which serves it to the webview through its own scheme handler
— so the picture above *is* the desktop's picture: one client, one framing, one
door, one `kaja-upstream` channel, and a server stream that is the same
forwarded stream rather than an event topic mirroring one.

```
   wails://localhost/…  ──►  WKURLSchemeHandler  ──►  webviewHandler
                                                        ├─ router.Mount  (/Api, /app)
                                                        └─ assetHandler  (the UI)
```

What crosses a Wails binding is what only the desktop can do at all: the files
under the scripts root, the native dialogs, `kaja://` links, the resolved
variables a script may read because the UI is inside this process, and the MCP
bridge. None of it is a call.

## What never crosses which line

- **Credentials and `${NAME}` values stay in Go.** The JS side sends
  references; the Go side resolves them on the way out and redacts them out of
  what an app reports exchanging, so the Headers view shows `Bearer ${TOKEN}`.
- **`X-Kaja-App` never reaches an upstream.** The one door removes it before
  anything is forwarded.
- **`kaja-upstream` never reads as the API's headers.** One boundary in
  `client.ts` consumes it, and an upstream that sent a trailer of that name has
  it dropped on the way in (`reservedMetadata`).
- **The tunnel never shows through.** An upstream HTTP failure arrives as the
  HTTP failure it was; an upstream gRPC status crosses as itself, not as a
  gateway 500.
- **Durations are stamped where the exchange happened.** Every Go hop measures
  its upstream call and the UI shows that number; only the run's wall time is
  the client's own clock.

## Seven traces

One real call per lane, hop by hop. Five are calls against the
demo workspace ([`workspace/kaja.json`](../workspace/kaja.json)); the workspace
has no folder app, and `kaja.fetch` belongs to no app.

What decides a path is who talks to the API:

| family | apps | the upstream call is made by |
| --- | --- | --- |
| forwarded | `grpc` | Go, forwarding the browser's own call |
| in-process | `openapi` · `twirp` · `mcp` · `openai` · `folder` | Go, from the request it built |
| neither | the Api service · `kaja.fetch` | nobody, or the browser itself |

**One door** — `ApiService.InvokeApp` — is the header work every call goes
through, in this order: `TakeAppName` (pull `X-Kaja-App` out) · `ExpandAll`
(`${NAME}`) · `appConnection` (read the app out of `kaja.json` now, for its
credential and TLS) · `MergeMetadata` (apply it without displacing a header of
the same name). Then the clock starts and the app is looked up by name.

### 1. gRPC — `Seating.GetSeatMap({ showId: "apollo-13@the-lantern" })`

Web

1. `client.ts` — merge headers, add `X-Kaja-App: seating`; each goes on the meta as `X-Header-<name>`. There is nothing else to say: the app's name is the address
2. `POST localhost:41520/app/seating.Seating/GetSeatMap`, `application/grpc-web-text`
3. `grpc.Serve` de-frames the message → `InvokeApp` — the one door
4. the grpc app's `Instance` → `OpenServerStream` — every call, unary or not
5. **gRPC/HTTP2 → `seating.kaja.tools:443`, `/seating.Seating/GetSeatMap`**. No deadline: the call lives as long as the browser's request
6. back — binary `grpc-web+proto` frames as they arrive, then a trailer frame: `grpc-status`, the server's own metadata, and `kaja-upstream` carrying the duration
7. `absorbReserved` eats `kaja-upstream`; the rest is the call's response headers

Desktop — every hop above, unchanged. Hop 2 is
`POST wails://localhost/app/seating.Seating/GetSeatMap` rather than
`localhost:41520`, and the mux behind that scheme is the one hop 3 names. A
server stream is the same forwarded stream, frame by frame, and there is no
deadline of Kaja's own on either build.

### 2. OpenAPI — `Theatre.ListShows({ city: "Chicago", limit: 25, … })`

Title *Theatre*, no tags, so the method path is
`openapi.theatre.Theatre/ListShows`.

Web

1. `X-Kaja-App: theatre` — and nothing about where the app lives
2. `POST localhost:41520/app/openapi.theatre.Theatre/ListShows`
3. `grpc.Serve` reads the frame → `apiService.InvokeApp`
4. `InvokeApp` — `ExpandAll`, start the clock, look the app up by name
5. protobuf → `protojson` → `transcode`: path `/shows`, query params from the marked fields, spec auth then app headers then per-call header params
6. **`GET https://theatre.kaja.tools/shows?city=Chicago&limit=25`, made by Go**
7. JSON → `protojson` back, strict first then with unreadable members pruned
8. stamp `DurationMs`, `Redact` the resolved `${NAME}` values back out
9. one message frame + one trailer: `kaja-upstream` with `durationMs`, `requestHeaders`, `responseHeaders`
10. `absorbReserved` — so the Headers view shows the **theatre.kaja.tools** exchange, with `Bearer ${TOKEN}` where a variable stood

An upstream `>= 400` is an `apps.UpstreamError`: the whole failure rides under
`error` in the same trailer and the frame's `grpc-status` is only the closest
mapping.

Desktop — every hop, the same code reached the same way. So on **both** builds
Go talks to theatre.kaja.tools and the page never connects, which is the whole
difference from trace 1.

### 3. Twirp — `Quirks.Sum({ a: "2", b: "3" })`

A Twirp method is a POST of the request message at a URL, which is a thing this
process does rather than a protocol the client needs, so the app transcodes
nothing and there is nothing to transcode. Hops 1–4 and 8–10 are trace 2's. The
middle is that there is no middle:

5. no transcode — the protobuf the client framed is the body, under `Content-Type: application/protobuf`, unless the app configures that name itself
6. **`POST https://quirks.kaja.tools/twirp/quirks.v1.Quirks/Sum`, made by Go**
7. the response bytes are the method's response message, verbatim

A Twirp error is an HTTP failure carrying a JSON body, so it comes back as an
`apps.UpstreamError` like any other app's: the row is labelled `404`, the response
tab shows `{"code":…,"msg":…}` as the API sent it, and `msg` is the summary. Desktop
is trace 2's desktop.

### 4. MCP — `Concierge.SuggestFilm({ mood, party, city })`

`suggest_film` becomes `mcp.Tools/SuggestFilm`. Hops 1–4 and 8–10 are trace
2's. The middle:

5. protobuf → the arguments object it stands for (each field carries the property's own `json_name`, so the message **is** the arguments) → `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"suggest_film","arguments":{…}}}`
6. **`POST https://concierge.kaja.tools/mcp`** — `application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version`, then the era's pair: modern gets `Mcp-Method` + `Mcp-Name`, handshake-era gets `Mcp-Session-Id`. The era was settled once, by a `server/discover` probe.
7. a JSON object, or an SSE stream whose last data event is the response → `content` + `isError` + `structuredContent`. `isError: true` is an ordinary response, not a failure.

Desktop is trace 2's desktop; hops 5–7 don't change.

### 5. Folder — `Folder.ReadFile({ file: "team/notes.md" })`

Static proto surface, so `folder.Folder/ReadFile` whatever the app is called.
Hops 1–4 are trace 2's.

5. **No wire.** `filepath.IsLocal` as a lexical check, then an `os.Root` rooted at the app's `path` — the boundary is the syscall, symlinks included
6. nothing forwarded, nothing exchanged: no request or response headers, so `kaja-upstream` holds the duration alone

The one thing that differs by build is **whose disk**: yours on the desktop
(sandboxed macOS reaches it through a security-scoped bookmark), the
**server's** on the web — which is why a deployed kaja's folder app is a
container's filesystem and not the reader's.

### 6. Internal API — `GetConfiguration`

No app, so the door has nothing to look up and there is no upstream. `api.proto` declares no
package, so the gRPC path is `/Api/GetConfiguration`. Both builds reach the
service through `ApiService.Invoke`, which dispatches off the generated
`Api_ServiceDesc` and takes encoded protobuf, handing back the stream its responses
arrive on, so neither door needs generated code of its own.

Web

1. `POST localhost:41520/Api/GetConfiguration`, `application/grpc-web-text`
2. the same `grpc.Serve` the app lane uses de-frames the message → `ApiService.Invoke`, whose answer is a stream of one
3. `GetConfiguration` — read `kaja.json`, migrate, resolve variables against the **environment alone** (no `VariableStore` on the web), build `Runtime`
4. back — one data frame and a trailer frame carrying `grpc-status` alone: nothing was forwarded, so there is no `kaja-upstream` to say. It never left the server's machine.

Desktop

1. `POST wails://localhost/Api/GetConfiguration`, the webview's own origin
2. the same `grpc.Serve` → `ApiService.Invoke`
3. same service, but **with** a `VariableStore`, so a value can resolve `KEYCHAIN`
4. a failed call is `status.Convert`'s `UNKNOWN` in the trailer either way, carrying the service's own message

`Compile` is the one method here that streams — the compilation's log as it is
written, then its verdict. Nothing in the request says which kind of call this
is, so the door is the same `grpc.Serve`, writing more data frames before the
same trailer.

### 7. `kaja.fetch` — `await fetch("https://api.example.com/v1/things")`

The bare name inside a script body is bound to `kaja.fetch` (`runtimeBindings`),
unless an import of the script's own is called `fetch`. So there is no
unrecorded request a script can make, and this trace is the same on both builds.

1. `describeRequest` reads the verb, the absolute URL, the body and the headers — without sending
2. back comes a `Call<Response>`, which starts when awaited; holding it instead is what makes `kaja.approve(kaja.fetch(url, { method: "DELETE" }))` work
3. on start — `acquireRateLimit(host)`. The budget is the **host's**, because that is what a fetch has instead of an app (`kaja.rateLimit("api.example.com")`)
4. the row is written: `http` on the `MethodCall` is what marks it a fetch, with `service`/`method` filled from the host and the verb, so it is named `GET api.example.com · /v1/things`
5. **browser → `api.example.com` directly.** Kaja carries nothing: no door, no `X-Kaja-App`, no Go process on either build
6. `holdResponse` reads the body once and hands the script a `Response` over the same bytes — which is why a streamed response is the one thing `kaja.fetch` does not carry
7. 2xx → `output`; non-2xx → an upstream-failure-shaped error (status, request line, body), so the row goes red with `404` on it and the response tab shows what the API sent — **and the `Response` is still handed back**, with `ok` false, because that is fetch

A request that never completed **throws**, unlike a service method's failure: a
script that wrote a `try`/`catch` is written against fetch's contract, and this
is the one place Kaja's "reported, never thrown" gives way to the API it
borrowed.

Because Kaja is not in the path: CORS is the API's to allow (an API that sends
none needs an app), a `${NAME}` in a header is **not** expanded — the script
reads `kaja.variables` and passes the value — and the response headers are the
API's own directly. Routing it through Go would make a deployed kaja a proxy
for arbitrary URLs, which it must not be.

The one thing that differs by build is what `kaja.variables` holds: resolved on
the **desktop** (the UI runs inside the app's process, `ResolvedVariables`), so
a script can read a keychain value; the configuration's own text on the **web**,
where `kaja.variables.TOKEN` reads back the literal `${secret}`.
