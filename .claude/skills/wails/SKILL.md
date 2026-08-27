---
name: wails
description: Quick reference for Wails v3, the Go + native-webview desktop framework. Use whenever the task touches a Wails project — `build/config.yml`, `application.New`, `application.Options`, `app.Window`/`app.Event`/`app.Dialog`/`app.Menu`, services and `ServiceStartup`, the generated bindings under `frontend/bindings/`, the `@wailsio/runtime` npm package, `wails3 dev` / `wails3 generate bindings` / `wails3 task`, embedded `frontend/dist`, code signing, or anything in `desktop/main.go` that wires up a Wails app. Also use when the user mentions WebView2, WebKitGTK, or "the desktop build."
---

# Wails v3

Wails builds desktop apps from a Go backend and a web frontend that runs inside the platform's **native webview** — WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. There is no embedded Chromium. The Go process and the webview talk over an HTTP-based IPC transport that the generated bindings and the runtime package sit on top of.

v3 is a rewrite, not a version bump. If you are reading v2 code or v2 answers, everything below is different.

## Mental model

```
┌──────────────────── Go process ─────────────────────┐
│  app := application.New(application.Options{        │
│      Services: []application.Service{               │
│          application.NewService(&MyService{}),      │
│      },                                             │
│      Assets: application.AssetOptions{              │
│          Handler: application.AssetFileServerFS(fs) │
│      },                                             │
│  })                                                 │
│  win := app.Window.NewWithOptions(...)              │
│  app.Run()                                          │
│                                                     │
│  app.Event / app.Dialog / app.Menu / app.Window ... │
│        ▲                                            │
└────────┼────────────────────────────────────────────┘
         │  IPC: fetch("/wails/runtime") + events
┌────────┼────────────────────────────────────────────┐
│  webview                                            │
│   import { Greet } from "./bindings/<pkg>/service"; │
│   import { Events, Window } from "@wailsio/runtime";│
└─────────────────────────────────────────────────────┘
```

Three things carry the whole difference from v2:

- **There is no ambient context.** v2 threaded `context.Context` into every `runtime.*` call. v3 has methods on objects: `window.SetTitle(…)`, `app.Event.Emit(…)`, `app.Dialog.OpenFile()`. A service that needs them keeps an `*application.App` (and a window) of its own.
- **Bound structs are services.** `Bind: []interface{}{app}` became `Services: []application.Service{application.NewService(&app)}`. Lifecycle is the optional `ServiceStartup(ctx, options) error` / `ServiceShutdown() error` methods on the service itself.
- **Windows are first class and there can be many.** `app.Window.New()` / `NewWithOptions(...)` at any time; each is an object with its own methods and events.

## Generated frontend code

`wails3 generate bindings` writes a tree under `frontend/bindings/` (`-d` relocates it), laid out by **Go import path**:

```
frontend/bindings/
└── github.com/you/yourapp/
    ├── myservice.ts     # one file per service, one export per method
    ├── models.ts        # classes for the Go types those methods name
    └── index.ts         # re-exports both
```

The files import `@wailsio/runtime` (an npm dependency) unless generated with `-b`, which inlines a bundled copy instead. Methods return a `CancellablePromise`. Don't hand-edit them; **do** commit them if your build expects them to be there.

## Project layout (template default)

```
.
├── main.go            # application.New + //go:embed all:frontend/dist
├── greetservice.go    # a service
├── Taskfile.yml       # the build; `wails3 build` and `wails3 package` run its tasks
├── go.mod
├── build/
│   ├── config.yml     # project config: info, dev_mode, fileAssociations, protocols
│   ├── appicon.png    # source icon
│   ├── Taskfile.*.yml # per-platform build/package tasks
│   ├── Info.plist     # macOS (+ Info.dev.plist)
│   └── nsis/, appimage/
└── frontend/
    ├── package.json   # depends on @wailsio/runtime
    ├── src/
    ├── dist/          # build output, embedded by go:embed
    └── bindings/      # generated
```

## The cheatsheet

```bash
# Install / update CLI
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
wails3 doctor                       # diagnose toolchain & system deps

# New project
wails3 init -n MyApp -t react-ts

# Develop: watches Go files, runs the processes in build/config.yml's dev_mode
wails3 dev
wails3 dev -config ./build/config.yml -port 9245

# Build / package — these are Taskfile wrappers, not builders
wails3 build                        # runs the `build` task
wails3 package                      # runs the `package` task (bundle/installer)
wails3 task --list

# Generate
wails3 generate bindings -d frontend/bindings -ts     # TypeScript
wails3 generate icons -windowsfilename ""             # build/darwin/icon.icns
wails3 update build-assets -config build/config.yml   # re-render plists etc.
```

A project without Taskfiles uses the CLI for generation only and builds with plain `go build`; the produced binary needs nothing else to run. Bundling it is the platform's own recipe — on macOS, a directory holding `Contents/MacOS/<binary>`, `Contents/Resources/icon.icns` and `Contents/Info.plist`.

## Where to read deeper

Pull these in only when the task actually needs them:

- **CLI** — every command and flag for `init`, `dev`, `build`, `package`, `generate`, `task`, `doctor`, `sign`. → `references/cli.md`
- **`build/config.yml`** — `info`, `dev_mode`, `fileAssociations`, `protocols`, and the Taskfile layout around it. → `references/config.md`
- **`application.Options` / `WebviewWindowOptions`** — every field, plus per-platform `MacOptions`/`WindowsOptions`/`LinuxOptions` and `MacWindow`/`WindowsWindow`/`LinuxWindow`. → `references/options.md`
- **Services and bindings** — how Go methods become TS, models, `CancellablePromise`, the lifecycle interfaces, `Route`-mounted handlers, typed events. → `references/bindings.md`
- **Runtime API** — the Go managers (`app.Window`, `app.Event`, `app.Dialog`, `app.Menu`, `app.Clipboard`, `app.Browser`, `app.Screen`, `app.SystemTray`, …) and the JS `@wailsio/runtime` surface. → `references/runtime.md`
- **Gotchas** — v2 habits that break, `[]byte` marshalling, runtime side effects in a browser, WebView2/WebKitGTK quirks, build tags. → `references/gotchas.md`

## Working rules

- **Don't run `wails3 build` to "check it compiles"** — it drives a Taskfile that builds the frontend too. Use `go build ./...` or the project's own dev script. In this repo, prefer `scripts/desktop-build dev`.
- **`NewService` takes a pointer to a named type**: `application.NewService(&GreetService{})`. Anything else is an invalid `Service`.
- **A service reaches the app explicitly**, through a constructor argument, a field set before `Run`, or `application.Get()`. There is no context to capture.
- **`ServiceStartup` / `ServiceShutdown` / `ServiceName` / `ServeHTTP` are not bound** — the generator knows them by name and leaves them out of the frontend.
- **Methods must be exported**, and struct fields need `json` tags to appear in `models.ts` — unchanged from v2.
- **A first `context.Context` parameter is still auto-injected** and dropped from the JS signature.
- **`[]byte` crosses as base64 in both directions.** v2 sent a request as an array of numbers; v3 sends a base64 string. Encode on the way out, decode on the way in.
- **Errors reject with a `RuntimeError`** whose `message` is the Go error string.
- **Production assets are embedded** via `//go:embed all:frontend/dist`; `AssetFileServerFS` finds the directory holding `index.html` inside whatever FS it is given. The `all:` prefix is required to include dotfiles.
- **`-tags production`** embeds the runtime and closes the inspector. Without it, the asset server proxies to `FRONTEND_DEVSERVER_URL` when that is set.
- **Code signing & notarisation** have CLI wrappers (`wails3 signing`, `wails3 sign`, `wails3 entitlements`), but running `codesign` / `notarytool` on the produced bundle yourself is still fine.
