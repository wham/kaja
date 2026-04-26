# Common Gotchas

Things that bite repeatedly. If something feels wrong, scan this list before deep-diving.

## Webview platform deps

- **WebView2 (Windows)** is required at runtime. Distribute it via `wails build -webview2 download` (default), `embed` (fixed-version, larger binary), `browser` (assume installed), or `error` (refuse to launch without it). Verify locally with `wails doctor`.
- **WebKitGTK (Linux)** — Ubuntu 24.04+ ships only `libwebkit2gtk-4.1`. Build with `-tags webkit2_41`. For full asset-server features, also `webkit2_36` (non-GET methods/headers/status) and `webkit2_40` (request bodies). WebSockets through the asset server are unsupported on all platforms.
- **macOS minimum target** — `wails build` defaults can be too low for newer SDKs. Override:
  ```bash
  CGO_CFLAGS=-mmacosx-version-min=10.15.0 \
  CGO_LDFLAGS=-mmacosx-version-min=10.15.0 \
  wails build
  ```
  macOS 15+ requires Go 1.23.3+.

## Lifecycle ordering

- `OnStartup` fires **before** `index.html` loads. Runtime calls that touch the window (e.g. `WindowShow`, dialogs) may fail. Capture `ctx` here, do real work in `OnDomReady`.
- `OnBeforeClose` returning `true` cancels the close. Use this for "quit anyway?" prompts.
- `Quit(ctx)` does **not** trigger `OnBeforeClose` — it's a direct exit. If you need confirmation everywhere, route everything through a single `requestClose()` helper.

## Bindings

- `Bind` takes **instances**, not types: `Bind: []interface{}{ app }` with `app := &App{}`. Passing `App{}` as a value works but the methods need value receivers.
- Methods must be **exported** — lowercase first letter is invisible to JS.
- Struct fields without `json` tags are silently dropped from `models.ts`. If TS types look anaemic, check tags first.
- Anonymous nested structs aren't supported. Name the inner type.
- `context.Context` first-arg → auto-injected, JS signature drops it.
- After changing a Go method signature, `frontend/wailsjs/` regenerates on next `wails dev`/`wails build`. If you import from a stale path or a different `wailsjsdir`, you'll see ghost types — `wails generate module` to force.

## `wails dev` quirks

- Default dev server: `http://localhost:34115`. Open it in a real browser for proper devtools (the embedded webview's devtools are limited). Override with `-devserver host:port`.
- `frontend:dev:watcher` runs a sibling process (e.g. `npm run dev`). Output is interleaved with Wails' own log — set a unique prefix in your watcher script if it gets noisy.
- `frontend:dev:serverUrl: "auto"` parses Vite's stdout to find the port; `-viteservertimeout` is in seconds.
- **Vite ≥ 5.0.0 + `assetserver.Handler`** is broken in Wails v2 (issue #3240). If you depend on the Handler fallback during dev with Vite, pin to v4 or work around it.
- `-assetdir ./frontend/dist` reads assets from disk instead of `embed.FS` — useful when iterating without rebuilding the Go binary.

## Embedded vs filesystem assets

- `//go:embed all:frontend/dist` requires the **`all:`** prefix to include dotfiles (e.g. `.well-known/`).
- The embed dir must exist at build time. `wails build` creates `frontend/dist/.gitkeep` automatically; turn it off with `-skipembedcreate`.
- The asset server resolves the directory containing `index.html` inside the FS — don't nest `index.html` deeper than the embed root unless you point `Assets` at a subFS.

## Single instance

```go
SingleInstanceLock: &options.SingleInstanceLock{
    UniqueId: "dc9a36e3-...-uuid",
    OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
        // Re-focus existing window, handle CLI args from the second launch
    },
},
```

Without this, multiple launches each get their own window.

## Panic recovery

- Wails recovers from panics in IPC handlers by default and logs them. Disable with `DisablePanicRecovery: true` if you want the process to die.
- On Linux, WebKit installs signal handlers without `SA_ONSTACK`, which can clash with Go's panic recovery in goroutines. Call `runtime.ResetSignalHandlers()` from a goroutine that needs reliable Go panic recovery.

## Dialogs & file paths

- `MessageDialog` button strings differ per platform — see `references/runtime.md`. Don't hard-code `"OK"` (case-sensitive) when comparing returns.
- macOS `OpenDialogOptions.ResolvesAliases: true` returns the resolved path; with `false` you get the alias path.

## Drag-and-Drop

- `DragAndDrop.EnableFileDrop: true` is opt-in.
- Two ways to receive drops: `runtime.OnFileDrop(ctx, cb)` in Go, or `EventsOn("wails:file-drop", cb)` in JS. Pick one.
- The CSS-target mode (`OnFileDrop(cb, true)` in JS) toggles a `wails-drop-target-active` class on elements whose CSS sets the configured drop property.

## File / URL associations

- Declared in `wails.json` `info.fileAssociations` / `info.protocols`.
- macOS callbacks: `mac.Options.OnFileOpen` / `OnUrlOpen`. These fire even on cold launch — be ready to defer work until `OnDomReady`.
- Windows associations are wired through the NSIS installer.

## Build hygiene

- `wails build` runs `frontend:install` then `frontend:build`. To skip both: `-s`. To skip `go mod tidy`: `-m`. To skip bindings regen: `-skipbindings`.
- `-trimpath` and `-ldflags "-s -w"` are recommended for release builds. Combine with `-X main.Version=$(git describe --tags)` to embed a version.
- UPX has known issues on Apple Silicon and triggers Windows AV false-positives. Don't enable it by default.
- Don't commit `frontend/wailsjs/`, `frontend/dist/`, or `desktop/build/bin/` — all regenerated.

## Project conventions in this repo

- Use `scripts/desktop` rather than `wails dev` directly — it sets up `wailsjsdir` redirection (`../ui/src`), embeds the bundled UI, and wires the dev hot-reload.
- The frontend pipeline is integrated through Wails project hooks (see recent commits) — don't run `scripts/build-ui` separately.
- `cmd+R` rebuilds the desktop UI in dev (`8e679f5`).
- Generated code under `ui/src/wailsjs/**` is **not** edited by hand and is regenerated by `wails dev`/`wails build`.
