# Wails CLI

All commands: `wails <command> [flags]`.

## `wails init` — scaffold a new project

| Flag | Description | Default |
|---|---|---|
| `-n "name"` | Project name (required) | — |
| `-d "dir"` | Project directory | name |
| `-t "template"` | Template name or remote URL | `vanilla` |
| `-g` | Init git repo | |
| `-l` | List built-in templates | |
| `-q` | Quiet | |
| `-ide vscode\|goland` | Generate IDE files | |
| `-f` | Overwrite if dir exists | false |

Built-in templates: `vanilla`, `svelte`, `react`, `vue`, `preact`, `lit` — each also as `-ts` (e.g. `react-ts`).

Remote: `wails init -n test -t https://github.com/leaanthony/testtemplate@v1.0.0`.

## `wails build` — production build

Outputs to `build/bin/`.

| Flag | Description |
|---|---|
| `-platform list` | `darwin`, `darwin/amd64`, `darwin/arm64`, `darwin/universal`, `windows`, `windows/amd64`, `windows/arm64`, `linux/amd64`, `linux/arm64`. Comma-separated. |
| `-clean` | Wipe `build/bin` first |
| `-debug` | Keep debug info, show debug console, enable devtools |
| `-devtools` | Enable devtools in production (Mac App Store reject risk) |
| `-dryrun` | Print build command without running |
| `-f` | Force rebuild |
| `-ldflags "..."` | Extra `-ldflags` for Go |
| `-tags "..."` | Build tags. Quoted; space- or comma-separated, not both |
| `-trimpath` | `go build -trimpath` |
| `-race` | Race detector |
| `-o filename` | Output binary name |
| `-nopackage` | No `.app` / installer wrapping |
| `-nsis` | Generate NSIS installer (Windows) |
| `-webview2 strategy` | Installer behaviour: `download` (default), `embed`, `browser`, `error` |
| `-windowsconsole` | Keep Windows console window |
| `-upx` | Compress binary with UPX |
| `-upxflags "..."` | Args for UPX |
| `-obfuscated` | Obfuscate via [garble](https://github.com/burrowers/garble) |
| `-garbleargs "..."` | Args for garble (default `-literals -tiny -seed=random`) |
| `-s` | Skip frontend build |
| `-skipbindings` | Skip `wailsjs/go/...` regeneration |
| `-skipembedcreate` | Don't auto-create missing embed dirs / `.gitkeep` files |
| `-m` | Skip `go mod tidy` |
| `-u` | Update `go.mod` to match CLI's Wails version |
| `-nosyncgomod` | Don't touch `go.mod` Wails version |
| `-compiler "go"` | Alternative go compiler |
| `-nocolour` | Disable coloured output |
| `-v 0\|1\|2` | Verbosity (default 1) |

Override macOS minimum target:
```bash
CGO_CFLAGS=-mmacosx-version-min=10.15.0 \
CGO_LDFLAGS=-mmacosx-version-min=10.15.0 \
wails build
```

## `wails dev` — development with hot reload

Compiles, runs the binary, watches files. Exposes the app on `http://localhost:34115` (any browser can connect — useful for browser devtools).

| Flag | Description | Default |
|---|---|---|
| `-assetdir "./path"` | Serve assets from disk instead of embed.FS | from `wails.json` |
| `-extensions "go,..."` | File extensions that trigger Go rebuild | `go` |
| `-reloaddirs "a,b"` | Extra dirs to watch for asset reload | from `wails.json` |
| `-debounce N` | Debounce ms for asset reload | 100 |
| `-devserver "host:port"` | Dev server bind address | `localhost:34115` |
| `-frontenddevserverurl url\|auto` | Hand off to a 3rd-party dev server (Vite, etc.). `auto` parses Vite's stdout. | `""` |
| `-viteservertimeout N` | Seconds to wait for Vite when `auto` | 10 |
| `-browser` | Open `http://localhost:34115` on start | |
| `-noreload` | Disable auto-reload on asset change | |
| `-loglevel "Debug"` | Trace, Debug, Info, Warning, Error | Debug |
| `-appargs "..."` | Args passed to your app (shell-quoted) | |
| `-tags "..."` | Build tags | |
| `-ldflags "..."` | Extra ldflags | |
| `-race` | Race detector | false |
| `-s` | Skip frontend build | |
| `-skipbindings` | Skip `wailsjs/go/...` regeneration | |
| `-skipembedcreate` | Skip embed dir creation | |
| `-forcebuild` | Force build | |
| `-wailsjsdir` | Where to emit JS modules | from `wails.json` |
| `-save` | Persist `assetdir`/`reloaddirs`/`wailsjsdir`/`debounce`/`devserver`/`frontenddevserverurl`/`viteservertimeout` to `wails.json` | |
| `-nosyncgomod` | Don't sync `go.mod` | false |
| `-compiler "go"` | Alternative compiler | go |
| `-v 0\|1\|2` | Verbosity | 1 |

## `wails generate`

- `wails generate module [-compiler go] [-tags "..."]` — manually regenerate `frontend/wailsjs/`. `dev`/`build` do it automatically.
- `wails generate template -name <name> [-frontend <path>]` — scaffold a new template from an existing frontend project.

## `wails doctor`

Checks Go, Node, npm, pkg-config, gcc, libgtk, libwebkit, WebView2, NSIS, UPX, etc. Run when something feels off.

## `wails update`

| Flag | Description |
|---|---|
| `-pre` | Update to latest pre-release |
| `-version <ver>` | Pin to a specific version |

## `wails version`

Prints the CLI version. Combine with `go list -m github.com/wailsapp/wails/v2` to confirm CLI ≈ library version.
