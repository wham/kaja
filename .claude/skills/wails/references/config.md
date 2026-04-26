# `wails.json`

Project config consumed by `wails dev` and `wails build`. JSON schema: `https://wails.io/schemas/config.v2.json`.

## Full field list

```json5
{
  "$schema": "https://wails.io/schemas/config.v2.json",
  "version": "",
  "name": "",                          // app/project name
  "outputfilename": "",                // resulting binary name (no extension)

  // Dirs
  "build:dir": "",                     // default: "build"
  "frontend:dir": "",                  // default: "frontend"
  "wailsjsdir": "",                    // where generated JS modules go (default: frontend/)
  "assetdir": "",                      // compiled-assets dir (auto-detected if empty)

  // Frontend hooks
  "frontend:install": "",              // e.g. "npm install"
  "frontend:build": "",                // e.g. "npm run build"
  "frontend:dev": "",                  // legacy; falls back to frontend:build
  "frontend:dev:install": "",          // dev counterpart of frontend:install
  "frontend:dev:build": "",            // dev counterpart of frontend:build
  "frontend:dev:watcher": "",          // long-running process during `wails dev` (e.g. "npm run dev")
  "frontend:dev:serverUrl": "",        // 3rd-party dev server URL, or "auto" (Vite)
  "viteServerTimeout": 10,

  // Watch / dev
  "reloaddirs": "",                    // extra dirs that trigger reload (comma)
  "debounceMS": 100,
  "devServer": "",                     // default: "localhost:34115"
  "appargs": "",                       // args for the app in dev mode

  // Build hooks. Keys are GOOS/GOARCH; "*" matches anything
  "runNonNativeBuildHooks": false,
  "preBuildHooks":  { "GOOS/GOARCH": "", "GOOS/*": "", "*/*": "" },
  "postBuildHooks": { "GOOS/GOARCH": "", "GOOS/*": "", "*/*": "" },

  // Build flags / metadata
  "build:tags": "",                    // tags applied to all builds
  "obfuscated": "",
  "garbleargs": "",
  "nsisType": "",                      // "multiple" (per-arch) | "single" (universal)

  // App info
  "info": {
    "companyName": "",
    "productName": "",
    "productVersion": "",
    "copyright": "",
    "comments": "",
    "fileAssociations": [
      {
        "ext": "wails",
        "name": "Wails",
        "description": "Wails File",
        "iconName": "fileIcon",
        "role": "Editor"
      }
    ],
    "protocols": [
      { "scheme": "myapp", "description": "MyApp Protocol", "role": "Editor" }
    ]
  },

  "author": { "name": "", "email": "" },

  // Bindings codegen
  "bindings": {
    "ts_generation": {
      "prefix": "",
      "suffix": "",
      "outputType": "classes"          // "classes" | "interfaces"
    }
  }
}
```

## Hook substitution

In `preBuildHooks` / `postBuildHooks`:

- `${platform}` → `GOOS/GOARCH` (e.g. `darwin/arm64`)
- `${bin}` → path to compiled binary (post hooks only)

Hook resolution order: `GOOS/GOARCH` runs first, then `GOOS/*`, then `*/*`. Non-matching hooks are skipped. Set `runNonNativeBuildHooks: true` to also run hooks for non-host platforms.

## `wails dev` `-save` behaviour

The `-save` flag persists the following dev-only flags into `wails.json`:

- `assetdir`
- `reloaddirs`
- `wailsjsdir`
- `debounceMS`
- `devServer`
- `frontenddevserverurl`
- `viteServerTimeout`

## File / protocol associations

`info.fileAssociations` and `info.protocols` populate platform metadata: `Info.plist` on macOS, NSIS installer on Windows, `.desktop` files on Linux. The corresponding open events come back through `mac.Options.OnFileOpen` / `OnUrlOpen` (or the `runtime.OnFileDrop` event for drops).

## Custom bindings prefix/suffix

`bindings.ts_generation.prefix`/`suffix` wrap every generated TS type in `models.ts`. `outputType: "interfaces"` emits `export interface` instead of class wrappers — useful when the frontend uses its own constructors.

## Sample (this repo)

`/Users/wham/code/kaja/desktop/wails.json`:

```json
{
  "$schema": "https://wails.io/schemas/config.v2.json",
  "name": "Kaja",
  "outputfilename": "Kaja",
  "wailsjsdir": "../ui/src",
  "info": {
    "productName": "Kaja",
    "productVersion": "0.10.0",
    "copyright": "2026 Tomas Vesely"
  },
  "author": { "name": "Tomas Vesely", "email": "..." }
}
```

`wailsjsdir: "../ui/src"` is relative to `desktop/`, so generated bindings land under `ui/src/wailsjs/`.
