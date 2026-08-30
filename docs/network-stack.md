# The network stack

Every call a script makes through an app starts as JavaScript and crosses one
Go process before it reaches an API. This is the map: the lane a call travels,
what each hop adds and removes, and what comes back out of band.
[AGENTS.md](../AGENTS.md) records the rules; the [seven traces](#seven-traces)
at the end walk one real call through each lane.

## Three facts carry the whole picture

**1. The client speaks gRPC-Web and nothing else.** Whatever an app talks to
upstream, the page sends one kind of request: `POST /app/…` on its own origin,
framed as gRPC-Web. Which protocol reaches the API is the Go process's
business, so there is one browser transport, one framing and one out-of-band
channel — and one set of doors, which
[the desktop mounts](#the-desktop-mounts-the-same-mux) rather than
reimplements.

**2. The app's name is the only address.** The reserved request header
**`X-Kaja-App`** names the app a call belongs to, and that is all the browser
knows. The Go side takes the header out, looks the app up in `kaja.json` at
call time, expands `${NAME}` references and applies the app's credential —
none of which the browser ever holds.

**3. Everything Kaja has to say rides beside the response, never inside it.**
The reserved trailer **`kaja-upstream`** is one object: the duration Kaja
measured, the headers an app exchanged (redacted), and an HTTP failure shown
in place of the gRPC status it was tunnelled through. The client routes it
onto the call (`absorbReserved`) and never shows it as a response header.

```
┌─────────────── browser tab · desktop webview ───────────────────────────┐
│  script ── Shows.ListShows({ pageSize: 25 })                            │
│    └─► protobuf-ts client   (gRPC-Web fetch)                            │
│          X-Header-X-Kaja-App: shows                                     │
│          X-Header-<name>:     <value — ${NAME} travels unexpanded>      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │  POST /app/{pkg.Service/Method}
┌──────────────────────────── kaja (Go) ──────────────────────────────────┐
│  grpc.Serve — de-frame the request, invoke, frame out however many      │
│              messages come back, one at a time                          │
│   └─► InvokeApp — the one door (below)                                  │
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

## The one door

Every app call passes through `ApiService.InvokeApp`, which does the header
work in a fixed order:

1. **`TakeAppName`** — pull `X-Kaja-App` out of the headers.
2. **`ExpandAll`** — resolve `${NAME}` references. The browser sends them
   unexpanded, because the value behind one may be kaja's to hold and the
   browser's never to read.
3. **`appConnection`** — read the app out of `kaja.json` **now**, for its
   credential and TLS. At call time rather than held from Open, so a replaced
   token takes effect on the next call rather than the next compile.
4. **`MergeMetadata`** — apply the credential without displacing a header the
   app configures under the same name.

Then the clock starts and `Manager.Invoke` routes the call to the instance
registered under that name.

## Who talks to the API

| family | apps | the upstream call is made by |
| --- | --- | --- |
| forwarded | `grpc` | Go, forwarding the browser's own call |
| in-process | `openapi` · `twirp` · `mcp` · `openai` · `folder` | Go, from the request it built |
| neither | the Api service · `kaja.fetch` | nobody, or the browser — the desktop's own process where the webview cannot |

The two families are "who talks to the API", not two lanes. Every app answers
`Invoke` with an `apps.Stream` — the response messages, then the `Report` the
call ends with — and a unary method is the stream that stops after one
message, so nothing anywhere branches on what kind of method a call names.

- **Forwarded** — the request the browser framed is the request the upstream
  gRPC server gets, which is what carries a server stream through. Every
  forwarded call is opened as a server stream, because nothing in a gRPC-Web
  request says which kind of method it names and a unary call is a stream of
  one.
- **In-process** — Go builds the upstream request itself, from openapi's REST
  mapping down to twirp, whose whole job is posting the same protobuf bytes at
  `<url>/twirp/<method>`. The folder app is the one instance with no upstream
  arrow at all: its "exchange" is the disk behind `os.Root`, and it forwards
  no headers.

**There is no deadline.** A call lives exactly as long as the browser's
request: no timer of Kaja's own to cut a long stream short, and Stop's aborted
fetch cancels the call upstream.

## The way back

Responses leave as **binary** gRPC-Web frames (`application/grpc-web+proto`),
one frame per message, flushed as each arrives. Requests arrive in the same
format: the transport is told to send binary rather than the base64 it
defaults to. A `grpc-web-text` body is a third more bytes, and it is one
continuous base64 stream — a frame whose bytes miss a group boundary holds its
last two back until the next message gives them company, which on a stream is
a message held until the one after it. Binary frames have no such seam, so
neither direction has one.

The last frame is the trailer block:

| trailer | carries |
| --- | --- |
| `grpc-status` · `grpc-message` | the verdict — a genuine gRPC status, or the closest mapping of an HTTP failure |
| `kaja-upstream` | one JSON object: `durationMs`, `requestHeaders` and `responseHeaders` (`${NAME}` values redacted back out), and on a failure the whole `error` |
| *the server's own metadata* | a forwarded call only: what the gRPC server answered with, under its own names |

- **One carrier, one name.** There is one framing, so a Twirp failure is
  answered in gRPC-Web trailers like everything else rather than in a header
  of its own; and a trailer block is escaped, budgeted and parsed per name, so
  four keys bought nothing four fields of one object don't.
- **The block is bounded** (64 KB). A value that doesn't fit is dropped whole
  rather than cut — half a JSON object is worse than none — and a
  `kaja-upstream` too big is written again without the two header sets, so the
  failure itself still gets through.
- **Values are percent-escaped** (`escapeTrailerValue`). Clients split the
  block on CRLF and read it as Latin-1, so unescaped UTF-8 arrives mangled and
  a newline in a value would end its line early.
- **The tunnel never shows through.** An upstream HTTP failure rides whole
  under `error`; the `grpc-status` beside it only keeps a plain gRPC-Web
  client sensible. The client shows the HTTP failure and drops the tunnel.
- **An upstream cannot write into Kaja's channel.** The names carrying the
  frame (`content-type`, `grpc-status`, anything `-bin` or `kaja-upstream`)
  are dropped from a forwarded server's metadata on the way through.

## The desktop mounts the same mux

Nothing about a call is different on the desktop. `webviewHandler`
(`desktop/main.go`) registers the two lanes with the same `router.Mount` the
web server calls and hands the mux to Wails, which serves it to the webview
through its own scheme handler. The pictures above *are* the desktop's
pictures — one client, one framing, one door, one `kaja-upstream` — with
`wails://localhost` where the web has `localhost:41520`.

```
   wails://localhost/…  ──►  WKURLSchemeHandler  ──►  webviewHandler
                                                        ├─ router.Mount  (/Api, /app)
                                                        └─ assetHandler  (the UI)
```

What crosses a Wails binding instead is what only the desktop can do at all:
the files under the scripts root, the native dialogs, `kaja://` links, the
resolved variables a script may read because the UI is inside this process,
and the MCP bridge. None of it is a call.

## What never crosses which line

- **Credentials and `${NAME}` values stay in Go.** The JS side sends
  references; the Go side resolves them on the way out and redacts them out of
  what an app reports exchanging, so the Headers view shows `Bearer ${TOKEN}`.
- **`X-Kaja-App` never reaches an upstream.** The one door removes it before
  anything is forwarded.
- **`kaja-upstream` never reads as the API's headers.** One boundary in
  `client.ts` consumes it, and an upstream that sent a trailer of that name
  has it dropped on the way in.
- **The tunnel never shows through.** An upstream HTTP failure arrives as the
  HTTP failure it was; an upstream gRPC status crosses as itself, not as a
  gateway 500.
- **Durations are stamped where the exchange happened.** Every Go hop measures
  its upstream call and the UI shows that number; only the run's wall time is
  the client's own clock.

## Seven traces

One real call per lane. Five are calls against the demo workspace
([`workspace/kaja.json`](../workspace/kaja.json)); the workspace has no folder
app, and `kaja.fetch` belongs to no app.

Every app call — traces 1 to 5 — shares one spine, on both builds:

1. `client.ts` — merge the app's headers with the call's own and add
   `X-Kaja-App: <name>`; each rides the request as `X-Header-<name>`,
   `${NAME}` references intact. There is nothing else to say: the app's name
   is the address.
2. `POST <origin>/app/<pkg.Service/Method>`, `application/grpc-web+proto` —
   the origin is `localhost:41520` in a browser, `wails://localhost` on the
   desktop, and the same mux answers both.
3. `grpc.Serve` de-frames the message → `InvokeApp`,
   [the one door](#the-one-door): take the name, expand `${NAME}`, read the
   app out of `kaja.json`, merge its credential, start the clock.
4. **The app's `Instance` answers** — the part each trace below tells.
5. Back — binary frames as messages arrive, then the trailer: `grpc-status`,
   `kaja-upstream` (the duration, and the redacted exchange where Go made
   one), and a forwarded server's metadata under its own names.
6. `absorbReserved` eats `kaja-upstream`; everything left — header and trailer
   metadata read as one — is the call's response headers, which is what the
   Headers view shows as the API's own.

What differs is hop 4: who talks to the API, and how.

### 1. gRPC — `Seating.GetSeatMap({ showId: "apollo-13@the-lantern" })`

The grpc app forwards rather than transcodes: it opens `OpenServerStream` at
**`seating.kaja.tools:443`**, `/seating.Seating/GetSeatMap`, and the request
the browser framed is the request the server gets — every call, unary or not.
Response frames are forwarded as they arrive, and the server's own metadata
comes back in the trailer under its own names: this lane is a bridge rather
than a hop, so what the server answered with **is** the call's response
headers, on a refusal as well as a success. `kaja-upstream` carries the
duration alone — there is no second exchange to report.

### 2. OpenAPI — `Theatre.ListShows({ city: "Chicago", limit: 25, … })`

Title *Theatre*, no tags, so the method path is
`openapi.theatre.Theatre/ListShows`. The app transcodes: protobuf →
`protojson` → `transcode`, which reads the path (`/shows`) and query
parameters off the marked fields and layers headers in order — spec auth,
then app headers, then per-call header params. Then
**`GET https://theatre.kaja.tools/shows?city=Chicago&limit=25`, made by Go**;
the JSON answer comes back through `protojson`, strict first, then with
unreadable members pruned. `kaja-upstream` reports the whole exchange —
duration, request and response headers, `Bearer ${TOKEN}` where a variable
stood.

An upstream `>= 400` is an `apps.UpstreamError`: the whole failure rides
under `error` in the same trailer, and the frame's `grpc-status` is only the
closest mapping.

### 3. Twirp — `Quirks.Sum({ a: "2", b: "3" })`

A Twirp method is a POST of the request message at a URL — a thing this
process does rather than a protocol the client needs — so the middle is that
there is no middle: the protobuf the client framed is the body, under
`Content-Type: application/protobuf` unless the app configures that name
itself, at **`POST https://quirks.kaja.tools/twirp/quirks.v1.Quirks/Sum`**.
The response bytes are the method's response message, verbatim. A Twirp error
is an HTTP failure carrying a JSON body, so it comes back like any other
app's: the row is labelled `404`, the response tab shows `{"code":…,"msg":…}`
as the API sent it, and `msg` is the summary.

### 4. MCP — `Concierge.SuggestFilm({ mood, party, city })`

`suggest_film` becomes `mcp.Tools/SuggestFilm`. Each request field carries
the property's own `json_name`, so the decoded message **is** the arguments
object, wrapped as
`{"jsonrpc":"2.0","method":"tools/call","params":{"name":"suggest_film","arguments":{…}}}`
and posted at **`https://concierge.kaja.tools/mcp`** — `application/json`,
`Accept: application/json, text/event-stream`, `MCP-Protocol-Version`, then
the era's pair: modern gets `Mcp-Method` + `Mcp-Name`, handshake-era gets
`Mcp-Session-Id`. (The era was settled once, by a `server/discover` probe.)
Back comes a JSON object, or an SSE stream whose last data event is the
response → `content` + `isError` + `structuredContent`. `isError: true` is an
ordinary response, not a failure.

### 5. Folder — `Folder.ReadFile({ file: "team/notes.md" })`

Static proto surface, so `folder.Folder/ReadFile` whatever the app is called.
**No wire**: `filepath.IsLocal` as a lexical check, then an `os.Root` rooted
at the app's `path` — the boundary is the syscall, symlinks included. Nothing
forwarded, nothing exchanged, so `kaja-upstream` holds the duration alone.

The one thing that differs by build is **whose disk**: yours on the desktop
(sandboxed macOS reaches it through a security-scoped bookmark), the
**server's** on the web — which is why a deployed kaja's folder app is a
container's filesystem and not the reader's.

### 6. Internal API — `GetConfiguration`

Not an app call, so it leaves the spine at the address: no app, nothing for
the door to look up, no upstream.

1. `POST <origin>/Api/GetConfiguration` — `api.proto` declares no package, so
   the path is `/Api/<Method>`.
2. The same `grpc.Serve` de-frames the message → `ApiService.Invoke`, which
   dispatches off the generated `Api_ServiceDesc` and hands back the stream
   its responses arrive on — here, a stream of one.
3. `GetConfiguration` reads `kaja.json`, migrates, resolves variables and
   builds `Runtime`. The one build difference in the whole trace: the desktop
   has a `VariableStore`, so a value can resolve `KEYCHAIN`; the web resolves
   against the environment alone.
4. Back — one data frame and a trailer carrying `grpc-status` alone: nothing
   was forwarded, so there is no `kaja-upstream` to say. A failed call is
   `status.Convert`'s `UNKNOWN`, carrying the service's own message.

Two methods here stream, and nothing in a request says which kind of call it
is: the door is the same `grpc.Serve`, writing more data frames before the same
trailer. `Compile` streams the log as it is written, then the verdict.
`WatchConfiguration` stays open for the life of the window and sends the whole
configuration each time `kaja.json` changes on disk — the file being watched is
read where the change is noticed, so nothing is fetched after being told, and
neither build has a notification transport of its own.

### 7. `kaja.fetch` — `await fetch("https://api.example.com/v1/things")`

The bare name inside a script body is bound to `kaja.fetch`
(`runtimeBindings`), so there is no unrecorded request a script can make.
**No app, so no `X-Kaja-App` and nothing to look up** — and on the web, no Go
process either.

1. `describeRequest` reads the verb, the absolute URL, the body and the
   headers — without sending.
2. Back comes a `Call<Response>`, which starts when awaited; holding it
   instead is what makes `kaja.approve(kaja.fetch(url, { method: "DELETE" }))`
   work.
3. On start — `acquireRateLimit(host)`. The budget is the **host's**, because
   that is what a fetch has instead of an app
   (`kaja.rateLimit("api.example.com")`).
4. The row is written: `http` on the `MethodCall` marks it a fetch, named
   `GET api.example.com · /v1/things`.
5. **Who makes it is the build's one difference** (`sendFetch` in
   `fetchTransport.ts`). On the **web**, browser → `api.example.com`
   directly. On the **desktop** the page is served from `wails://`, an origin
   WebKit reads as insecure and opaque, so the browser's own request fails
   before it is sent whatever CORS the API allows: the call goes
   `POST wails://localhost/fetch` instead — the target under
   `X-Kaja-Fetch-Url` / `-Method`, the script's headers under `X-Header-<name>`
   as on the app lane — and `desktop/fetch.go` makes it. Back come the API's
   own status, headers and body, plus `X-Kaja-Fetch-Url` for where the response
   was finally read from and `X-Kaja-Fetch-Error` where there was no response
   at all. The transport consumes that channel and hands up the `Response`.
   The lane is registered in `webviewHandler`, never in `router.Mount`: a door
   that forwards any URL a caller names is one the web must not have.
6. `holdResponse` reads the body once and hands the script a `Response` over
   the same bytes — which is why a streamed response is the one thing
   `kaja.fetch` does not carry.
7. 2xx → `output`; non-2xx → an upstream-failure-shaped error (status,
   request line, body), so the row goes red with `404` on it and the response
   tab shows what the API sent — **and the `Response` is still handed back**,
   with `ok` false, because that is fetch. A request that never completed
   **throws**: the one place Kaja's "reported, never thrown" gives way to the
   API it borrowed.

On the web, Kaja is not in the path: CORS is the API's to allow (an API that
sends none needs an app), and the response headers are the API's own directly.
Routing *that* through Go would make a deployed kaja a proxy for arbitrary
URLs, which it must not be — which is why the desktop's lane is the desktop's
alone. Either way a `${NAME}` in a header is **not** expanded: the script reads
`kaja.variables` and passes the value.

What `kaja.variables` holds is the build's other difference: resolved values on
the **desktop** (the UI runs inside the app's process), the configuration's
own text on the **web**, where `kaja.variables.TOKEN` reads back the literal
`${secret}`.
