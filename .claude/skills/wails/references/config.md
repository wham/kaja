# Project configuration

v3 has **no `wails.json`**. A project's configuration is split in two:

- **`build/config.yml`** — what the product is, and what `wails3 dev` runs.
- **`Taskfile.yml` + `build/Taskfile.*.yml`** — how it is built and packaged.

## `build/config.yml`

```yaml
version: "3"

info:
  companyName: "My Company"
  productName: "My Product"
  productIdentifier: "com.mycompany.myproduct"
  description: "A program that does X"
  copyright: "(c) 2025, My Company"
  comments: "Some Product Comments"
  version: "0.0.1"
  # cfBundleIconName: "appicon"        # only when shipping an Assets.car icon bundle

dev_mode:
  root_path: .
  log_level: warn
  debounce: 1000
  ignore:
    dir: [.git, node_modules, frontend, bin]
    file: [.DS_Store, .gitignore, "*_test.go"]
    watched_extension: ["*.go", "*.js", "*.ts"]
    git_ignore: true
  executes:
    - cmd: wails3 build DEV=true
      type: blocking
    - cmd: wails3 task common:dev:frontend
      type: background
    - cmd: wails3 task run
      type: primary

fileAssociations:
  - ext: wails
    name: Wails
    description: Wails Application File
    iconName: wailsFileIcon
    role: Editor
    mimeType: application/x-wails      # optional

protocols:
  - scheme: myapp
    description: My App Link

other:
  - name: My Other Data
```

### `info`

Read by `wails3 update build-assets` (and `generate build-assets`) to render `build/darwin/Info.plist`, `build/windows/info.json`, the NSIS script and friends. Nothing reads it at runtime — an app that wants its own version at runtime embeds the file, or takes it through `-ldflags`.

`ios:` may sit beside `info:` to override `bundleID`, `displayName`, `version`, `company` and `comments` for the generated Xcode project.

### `dev_mode`

The watcher [atterpac/refresh](https://github.com/atterpac/refresh) configures itself from this block. `wails3 dev` reads it from whatever `-config` names.

| Key | Meaning |
|---|---|
| `root_path` | Directory to watch, and the working directory every `executes` command runs in |
| `log_level` | `debug`/`info`/`warn`/`error` |
| `debounce` | Milliseconds to coalesce changes over |
| `ignore.dir`, `ignore.file` | Names and globs to skip (`*_test.go` is always added) |
| `ignore.watched_extension` | Globs that **do** count as a change |
| `ignore.git_ignore` | Also honour `.gitignore` |
| `executes` | The processes, in order |

Each `executes` entry is `{cmd, type, dir?, delay_next?}`. `dir` is relative to `root_path`; `delay_next` pauses (ms) before the next entry.

| `type` | When it runs |
|---|---|
| `once` | The first pass only |
| `background` | Started on the first pass, left running |
| `blocking` | Every pass; the next entry waits for it |
| `primary` | Every pass; killed and restarted on each change |

### `fileAssociations` / `protocols`

Consumed by the build-asset templates: `CFBundleDocumentTypes` / `CFBundleURLTypes` on macOS, registry entries on Windows. They are **not** read at runtime — the bundle's plist is what actually registers a scheme, and a project maintaining its plist by hand declares them there instead.

The Go side hears about both as application events: `events.Common.ApplicationOpenedWithFile` (`event.Context().Filename()`) and `events.Common.ApplicationLaunchedWithUrl` (`event.Context().URL()`). `Options.FileAssociations` is a separate, runtime-side list of extensions.

## Taskfiles

`Taskfile.yml` at the project root includes `build/Taskfile.common.yml` and one per platform, and defines `build`, `package`, `run` and `dev`. `wails3 build`, `wails3 package` and `wails3 sign` are wrappers that run those tasks; `wails3 task --list` shows the rest.

The standard tasks are ordinary shell:

- `common:generate:bindings` → `wails3 generate bindings -f '{{.BUILD_FLAGS}}' -clean=true {{if .UseTypescript}}-ts{{end}}`
- `common:generate:icons` → `wails3 generate icons -input appicon.png`
- `common:build:frontend` → `npm run build` in `frontend/`
- `darwin:build` → `go build {{.BUILD_FLAGS}} -o {{.BIN_DIR}}/{{.APP_NAME}}` with `CGO_ENABLED=1` and `MACOSX_DEPLOYMENT_TARGET` set
- `darwin:create:app:bundle` → `mkdir` the `.app`, then copy `icons.icns`, the binary and `Info.plist` into it

`PRODUCTION=true` is what adds `-tags production -trimpath -ldflags="-w -s"`.

Because that is all it is, a project with its own build scripts can skip Taskfiles entirely and call the generators directly.
