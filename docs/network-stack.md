# The network stack

Every call a script makes starts as JavaScript and crosses at least one Go
process before it reaches an API. [AGENTS.md](../AGENTS.md) records the rules;
this is the picture: what carries a call on each build, what each hop adds and
removes, and what comes back out of band.

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
