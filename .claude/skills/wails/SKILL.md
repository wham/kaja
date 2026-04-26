---
name: wails
description: Quick reference for Wails v2, the Go + native-webview desktop framework. Use whenever the task touches a Wails project — `wails.json`, `wails.Run`, `options.App`, `assetserver`, the Go ↔ JS bindings under `frontend/wailsjs/`, the runtime API (`runtime.WindowSetTitle`, `runtime.EventsEmit`, `window.runtime.*`), `wails build` / `wails dev` / `wails generate`, embedded `frontend/dist`, dev-server hot reload, code signing, or anything in `desktop/main.go` that wires up a Wails app. Also use when the user mentions WebView2, WebKitGTK, or "the desktop build."
---

# Wails v2

Wails builds desktop apps from a Go backend and a web frontend that runs inside the platform's **native webview** — WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. There is no embedded Chromium. The Go process and the webview talk via generated JS wrappers and an IPC runtime.

## Mental model

```
┌─────────────── Go process ───────────────┐
│  main.go: wails.Run(&options.App{...})   │
│  Bind: []interface{}{ app }              │
│  AssetServer.Assets: embed.FS            │
│                                          │
│  context.Context  ──► runtime.* (Go)     │
│        ▲                                 │
└────────┼─────────────────────────────────┘
         │  IPC bridge (custom URL scheme)
┌────────┼─────────────────────────────────┐
│  webview                                 │
│   import { Method } from                 │
│     "../wailsjs/go/<pkg>/<Struct>";      │
│   import { EventsOn } from               │
│     "../wailsjs/runtime";                │
│   // also window.runtime.*               │
└──────────────────────────────────────────┘
```

Two key auto-generated trees inside the frontend:

- `frontend/wailsjs/go/<pkg>/<Struct>.{js,d.ts}` — JS wrappers for every exported method of every value in `Bind`. Calls return Promises.
- `frontend/wailsjs/runtime/runtime.{js,d.ts}` — the JS side of the runtime (window, dialog, events, log, browser, screen, clipboard, drag-drop). Also reachable via `window.runtime.*`.

Both regenerate on `wails dev` / `wails build`. Don't hand-edit them, don't commit them.

> Note: `wailsjsdir` in `wails.json` can relocate that tree. In this repo it points to `../ui/src`, so generated bindings land at `ui/src/wailsjs/`.

## Project layout (template default)

```
.
├── app.go            # bound App struct (NewApp, methods, ctx capture)
├── main.go           # wails.Run + //go:embed all:frontend/dist
├── wails.json        # project config
├── go.mod
├── build/
│   ├── appicon.png   # source icon
│   ├── darwin/       # Info.plist (+ Info.dev.plist for `wails dev`)
│   └── windows/      # icon.ico, info.json, manifest, NSIS templates
└── frontend/
    ├── package.json
    ├── src/
    ├── dist/         # build output, embedded by go:embed
    └── wailsjs/      # generated; gitignored
```

Production binary lands in `build/bin/<name>[.exe|.app]`.

## The cheatsheet

```bash
# Install / update CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor                       # diagnose toolchain & system deps

# New project
wails init -n MyApp -t react-ts    # templates: vanilla|svelte|react|vue|preact|lit (+ -ts)

# Develop (hot reload, dev server on :34115)
wails dev
wails dev -assetdir ./frontend/dist          # serve assets from disk
wails dev -frontenddevserverurl auto         # hand off to Vite (auto-detect port)
wails dev -tags webkit2_41                   # Ubuntu 24.04+

# Build
wails build
wails build -platform darwin/universal,windows/amd64
wails build -clean -trimpath -ldflags "-X main.GitRef=$(git rev-parse HEAD)"
wails build -nsis -webview2 embed            # Windows installer w/ embedded WebView2
wails build -debug -devtools                 # devtools in production binary

# Regenerate JS bindings only (rare; dev/build do it automatically)
wails generate module
```

`wails dev` watches Go files (`-extensions go`) for rebuilds and asset files (`-reloaddirs`, `-debounce`) for frontend reload. It also exposes the running app on `http://localhost:34115` so you can use real browser devtools.

## Where to read deeper

Pull these in only when the task actually needs them:

- **CLI flags** — every flag for `init`, `build`, `dev`, `generate`, `doctor`, `update`. → `references/cli.md`
- **`wails.json`** — every field, hooks, `${platform}` substitution, file associations, NSIS type. → `references/config.md`
- **`options.App`** — window/lifecycle/asset-server/menu/bind/error-formatter, plus per-platform `mac.Options`, `windows.Options`, `linux.Options`. → `references/options.md`
- **Bindings** — how Go methods become JS, JSON tags, `context.Context` injection, error/Promise mapping, enum binding. → `references/bindings.md`
- **Runtime API** — full Go + JS surface for window, dialog, events, log, browser, screen, menu, clipboard, drag-drop, notifications. → `references/runtime.md`
- **Gotchas** — WebView2/WebKitGTK quirks, vite-5 incompat, OnStartup vs OnDomReady, single-instance lock, panic recovery, Linux signal handlers. → `references/gotchas.md`

## Working rules

- **Don't run `wails build` to "check it compiles"** — it builds the frontend too and is slow. Use `go build -tags desktop` or whatever the project's dev script is. In this repo, prefer `scripts/desktop`.
- **Bind takes instances, not types**: `Bind: []interface{}{app}`, with `app := NewApp()`.
- **Capture `ctx` in `OnStartup`** and store it on the bound struct — runtime calls need it. `OnDomReady` is the safe place for runtime calls that touch the window.
- **Struct fields without `json` tags are invisible** to the generated TS. Anonymous nested structs aren't supported.
- **First `context.Context` parameter is auto-injected** — the JS-facing signature drops it.
- **Errors propagate as Promise rejections.** Customise the JSON shape with `options.ErrorFormatter`.
- **`wailsjs/` is generated.** If types look wrong, regenerate (`wails generate module`) before debugging.
- **Production assets are embedded** via `//go:embed all:frontend/dist`. The `all:` prefix is required to include dotfiles.
- **Cross-compilation** through `-platform a,b,c` works for Windows/Linux/Mac — but not all combinations (no Linux→macOS without extra toolchain). `darwin/universal` produces a fat binary.
- **Code signing & notarisation** are outside Wails — run `codesign` / `notarytool` on the produced `.app`.
