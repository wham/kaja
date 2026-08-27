# CLI (`wails3`)

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
```

The binary is `wails3`, not `wails` — v2 and v3 CLIs coexist.

Every command takes `-help` and `-nocolour`.

## `wails3 init` — new project

| Flag | Meaning | Default |
|---|---|---|
| `-n <name>` | Project name | |
| `-t <template>` | Built-in name, path, or URL | `vanilla` |
| `-l` | List built-in templates | |
| `-d <dir>` | Project directory | `.` |
| `-p <package>` | Go package name | `main` |
| `-mod <path>` | Go module path (computed from `-git` if unset) | |
| `-git <url>` | Git repository URL to initialise | |
| `-productname`, `-productversion`, `-productcompany`, `-productcopyright`, `-productdescription`, `-productidentifier`, `-productcomments` | Seed `build/config.yml` and the build assets | |
| `-skipgomodtidy` | Don't run `go mod tidy` | |
| `-s` | Skip the remote-template warning | |
| `-q` | Silent | |

Built-in templates: `vanilla`, `react`, `svelte`, `vue` — TypeScript — and `vanilla-js`, `react-js`, `svelte-js`, `vue-js`. Also `base` (no frontend framework) and `ios`. `-l` lists them.

## `wails3 dev` — development

| Flag | Meaning | Default |
|---|---|---|
| `-config <path>` | The project config file | `./build/config.yml` |
| `-port <n>` | Vite dev-server port | `9245` (or `$WAILS_VITE_PORT`) |
| `-s` | Use `https://` for the dev-server URL | |

`dev` does two things and no more:

1. Sets `FRONTEND_DEVSERVER_URL` to `http(s)://localhost:<port>`. A build **without** `-tags production` makes `application.AssetFileServerFS` proxy to that URL instead of serving the embedded FS — which is how a Vite dev server's HMR reaches the webview.
2. Runs the file watcher described by the config's `dev_mode` block, which is where the actual build and run commands live (see `references/config.md`).

It fails immediately if the port is already taken. There is no v2-style `-assetdir`, `-reloaddirs`, `-skipbindings` or `-wailsjsdir`: all of that is now either `dev_mode` or a Taskfile.

## `wails3 build` / `wails3 package` / `wails3 sign` — Taskfile wrappers

These do not build anything themselves. They run the `build`, `package` and `sign` tasks from the project's `Taskfile.yml`, forwarding extra `KEY=value` arguments as task variables.

| Flag (`build` only) | Meaning |
|---|---|
| `-tags "a,b"` | Merged into `EXTRA_TAGS` for the task |
| `-obfuscated` | Sets `OBFUSCATED=true` (garble, with stable binding IDs) |
| `-garbleargs "..."` | Sets `GARBLE_ARGS=...` |

A project with no Taskfile can't use them; build with `go build` and assemble the bundle yourself.

## `wails3 task` — the task runner

A vendored [Task](https://taskfile.dev) with the usual flags: `-list`, `-list-all`, `-dry`, `-f`, `-p`, `-C <n>`, `-dir <path>`, `-json`, `-i`, `-s`, `-output <style>`, `-watch`, `-interval <n>`.

## `wails3 generate`

| Command | Writes |
|---|---|
| `bindings` | The frontend bindings tree |
| `icons` | `.icns` and `.ico` from a PNG or `.icon` file |
| `syso` | The Windows `.syso` resource from `build/windows/info.json` |
| `constants` | JS constants from a Go file |
| `runtime` | A pre-built copy of the JS runtime |
| `build-assets` | A fresh set of build assets in a directory |
| `template` | A new template from an existing frontend project |
| `.desktop`, `appimage`, `webview2bootstrapper` | Linux/Windows packaging pieces |

### `generate bindings`

| Flag | Meaning | Default |
|---|---|---|
| `-d <dir>` | Output directory | `frontend/bindings` |
| `-ts` | TypeScript instead of JavaScript | off |
| `-i` | TS interfaces instead of classes | off |
| `-b` | Inline the bundled runtime instead of importing `@wailsio/runtime` | off |
| `-names` | Call by method name rather than by ID | off |
| `-models <name>` | Models filename, no extension | `models` |
| `-index <name>` | Index filename, no extension | `index` |
| `-noindex` | Don't write index files | off |
| `-noevents` | Don't emit types for registered custom events | off |
| `-time-type string\|Date` | JS type for `time.Time` | `string` |
| `-clean` | Wipe the output directory first | `true` |
| `-f "..."` | Extra Go build flags | |
| `-obfuscated`, `-obfuscated-output <dir>` | Keep binding IDs stable under garble | |
| `-dry` | Don't write | |
| `-silent`, `-v` | Quiet / debug output | |

Trailing arguments are Go package patterns; with none, the current directory is loaded.

### `generate icons`

| Flag | Meaning | Default |
|---|---|---|
| `-input <png>` | Source image | `build/appicon.png` |
| `-iconcomposerinput <.icon>` | Source Icon Composer file | |
| `-macfilename <path>` | Output `.icns` | `build/darwin/icon.icns` |
| `-macassetdir <dir>` | Output directory for `Assets.car` + `icons.icns` | |
| `-windowsfilename <path>` | Output `.ico` — pass `""` to skip | `build/windows/icon.ico` |
| `-sizes "256,128,…"` | Sizes inside the `.ico` | `256,128,64,48,32,16` |
| `-example` | Write an example `appicon.png` | |

## `wails3 update build-assets`

Re-renders the build assets (plists, NSIS scripts, `info.json`, …) from a config file. **It overwrites whatever is there**, so a project with hand-edited plists should not run it.

| Flag | Meaning | Default |
|---|---|---|
| `-config <path>` | Config file to read `info` / `fileAssociations` / `protocols` from | |
| `-dir <dir>` | Directory to write into | `build` |
| `-name`, `-binaryname` | Project and binary name | |
| `-product*` | Same seven product fields as `init`; a config value wins only where the flag is still at its default | |
| `-cfbundleiconname`, `-miniosversion` | macOS/iOS plist extras | |
| `-silent` | Quiet | |

## The rest

- `wails3 doctor` (`-json`) — toolchain and system-dependency report. `doctor-ng` is the new TUI.
- `wails3 service` — add or list first-party services.
- `wails3 signing` / `wails3 entitlements` / `wails3 sign` — code-signing setup and signing.
- `wails3 updater` — self-update key generation, signing, manifests.
- `wails3 ios` / `wails3 android` — mobile tooling.
- `wails3 mcp` — an MCP server exposing the CLI to an agent.
- `wails3 tool buildinfo` — inspect a built binary.
- `wails3 version`, `wails3 releasenotes`, `wails3 docs`.
