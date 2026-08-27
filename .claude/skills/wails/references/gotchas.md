# Common Gotchas

Things that bite repeatedly. If something feels wrong, scan this list before deep-diving.

## Coming from v2

- **`wails.Run(&options.App{})` is gone.** Three steps: `application.New(application.Options{…})`, `app.Window.NewWithOptions(…)`, `app.Run()`. Anything that must exist before the frontend loads happens between the second and the third.
- **`runtime.X(ctx, …)` is gone.** There is no ambient context. `runtime.WindowSetTitle(ctx, t)` → `window.SetTitle(t)`; `runtime.EventsEmit(ctx, n, d)` → `app.Event.Emit(n, d)`; `runtime.OpenDirectoryDialog(ctx, …)` → `app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false)…`.
- **`OnStartup(ctx)` / `OnShutdown(ctx)` on the bound struct** become `ServiceStartup(ctx, options) error` / `ServiceShutdown() error`. `Options.OnShutdown` is a plain `func()` for application-level cleanup. There is no `OnDomReady` — use the `WindowRuntimeReady` window event.
- **`Mac.OnUrlOpen` / `OnFileOpen` are gone.** They are application events: `events.Common.ApplicationLaunchedWithUrl` and `…ApplicationOpenedWithFile`, read off `event.Context()`. Register them before `Run` or a launch URL is lost.
- **`mac.AboutInfo` is gone.** The About box is `Options.Name`, `Options.Description` and `Options.Icon`, shown by the `About` role or `app.Menu.ShowAbout()`.
- **`mac.TitleBarHidden()` → `application.MacTitleBarHidden`** — a value, not a call, and it lives on the *window*'s `Mac` options, not the application's.
- **The app no longer quits with its last window on macOS.** Set `MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true}` to get v2's behaviour.
- **`options.RGBA{R,G,B,A}` → `application.NewRGB(r,g,b)` / `NewRGBA(...)`**, and it is a value rather than a pointer.
- **`LogLevel: logger.ERROR` → `LogLevel: slog.LevelError`.** Wails logs through `log/slog` now.
- **`frontend/wailsjs/` → `frontend/bindings/`**, laid out by Go import path, and the JS runtime is the `@wailsio/runtime` npm package rather than a generated file.
- **`wails.json` is gone**, and so is `wailsjsdir`, `assetdir`, `reloaddirs`, `frontend:build`, `frontend:dev:watcher`. Configuration is `build/config.yml` plus Taskfiles.
- **`wails build` no longer builds.** `wails3 build` runs a Taskfile task. A project without Taskfiles builds with `go build` and assembles the bundle itself.

## `[]byte` crosses as base64

A `[]byte` parameter arrives as a base64 **string**, and a `[]byte` return value comes back as one — v2 sent a request as an array of numbers. Encode before the call and decode after it. A `nil` or empty slice marshals as JSON `null`, which is not the same as `""`: decode defensively.

## The JS runtime has side effects

Importing `@wailsio/runtime` — which every generated binding does — installs a `contextmenu` handler that suppresses the browser menu, attaches drag-region and app-region listeners, `HEAD`s `/wails/custom.js`, and logs a large "⚠️ Browser Environment Detected" warning when it finds no native host.

That is right in a webview and wrong in a browser. An app that serves the same bundle to both must not import it eagerly: reach it (and the bindings) through `import()` behind a runtime check, which a bundler keeps in the bundle but only evaluates when something asks. Per-element opt-outs exist for the context menu (`--default-contextmenu: show`) but not for the rest.

Detecting a webview: `window._wails` is defined by the runtime itself, so it says nothing. The host's own message channel does — `window.chrome?.webview?.postMessage`, `window.webkit?.messageHandlers?.external?.postMessage`, `window.wails?.invoke` — which is exactly what the runtime looks for.

## Assets

- `AssetFileServerFS` searches the FS for the directory containing `index.html`, so `//go:embed all:frontend/dist` works without `fs.Sub`. The `all:` prefix is required to include dotfiles.
- **Without `-tags production`**, the asset handler proxies everything to `FRONTEND_DEVSERVER_URL` when that variable is set — which is how `wails3 dev` hands the frontend to Vite. A build that serves its own assets in development must not rely on the default handler, or must leave that variable unset.
- `BundledAssetFileServer` also serves `/wails/runtime.js`. Only needed when the page loads the runtime from a script tag.

## Bindings

- Methods must be **exported**; struct fields need `json` tags to reach `models.ts`; anonymous nested structs aren't supported.
- `ServiceStartup`, `ServiceShutdown`, `ServiceName` and `ServeHTTP` are recognised by name and never bound.
- A `map[string]string` is typed `{ [_ in string]?: string }` — values optional. Go never sends a missing value, but TypeScript can't know that.
- Calls dispatch by numeric ID by default. Regenerate after changing a signature; a stale bindings tree fails at the call, not at the type check.
- Generated files are the compiler's output, not a place to fix a type. Fix the Go, regenerate.

## Lifecycle

- Service startup runs before the frontend is served, so a runtime call that needs a loaded window can fail there. Hang it off `WindowRuntimeReady` instead.
- `Options.ShouldQuit` returning false refuses a quit; `app.Quit()` is a direct exit.
- Startup order is `Options.Services` then `RegisterService`, in registration order; shutdown is the reverse, after `Options.OnShutdown` and any `App.OnShutdown` hooks.

## Platform

- **WebView2 (Windows)** is required at runtime. `EnabledFeatures`/`DisabledFeatures`/`AdditionalBrowserArgs` are **global** — WebView2 shares one browser environment across every window.
- **WebKitGTK (Linux)** — v3 targets GTK4 + `webkitgtk-6.0` by default; GTK3 + `webkit2gtk-4.1` is behind the `gtk3` build tag. Install the matching `-dev` packages or the cgo build fails at `pkg-config`.
- **macOS deployment target** — set `MACOSX_DEPLOYMENT_TARGET` and the matching `-mmacosx-version-min` in `CGO_CFLAGS`/`CGO_LDFLAGS`, or cgo picks a version old enough that newer APIs warn about their own availability.
- **Traffic-light position** is not configurable. `MacTitleBar` is the whole of what the framework offers; anything else is AppKit code of your own.

## Build tags

| Tag | Effect |
|---|---|
| `production` | Embeds the runtime, closes the inspector, drops the dev-server proxy |
| `server` | Runs headless as an HTTP server (`Options.Server`) |
| `debug`, `devtools` | Extra logging / inspector in a non-production build |

`wails3 dev` merges anything the environment implies into `EXTRA_TAGS` for the Taskfile.
