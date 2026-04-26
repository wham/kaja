# Application Options (`options.App`)

Passed to `wails.Run(&options.App{...})` from `main.go`.

```go
import (
    "github.com/wailsapp/wails/v2"
    "github.com/wailsapp/wails/v2/pkg/options"
    "github.com/wailsapp/wails/v2/pkg/options/assetserver"
    "github.com/wailsapp/wails/v2/pkg/options/linux"
    "github.com/wailsapp/wails/v2/pkg/options/mac"
    "github.com/wailsapp/wails/v2/pkg/options/windows"
)
```

## Top-level fields

| Field | Type | Notes |
|---|---|---|
| `Title` | `string` | Window title |
| `Width`, `Height` | `int` | Default 1024×768 |
| `MinWidth`, `MinHeight`, `MaxWidth`, `MaxHeight` | `int` | Resize constraints |
| `DisableResize` | `bool` | Fixed-size window |
| `WindowStartState` | `options.WindowStartState` | `Fullscreen`, `Maximised`, `Minimised` (Minimised: not on macOS) |
| `Frameless` | `bool` | No borders / title bar |
| `StartHidden` | `bool` | Hide until `runtime.WindowShow` |
| `HideWindowOnClose` | `bool` | Close button hides instead of quits |
| `BackgroundColour` | `*options.RGBA` | `options.NewRGBA(r,g,b,a)` |
| `AlwaysOnTop` | `bool` | |
| `AssetServer` | `*assetserver.Options` | See below |
| `Menu` | `*menu.Menu` | App menu (default macOS menu auto-generated if nil) |
| `Logger` | `logger.Logger` | Default: stdout |
| `LogLevel` | `logger.LogLevel` | Default `Info` (dev) |
| `LogLevelProduction` | `logger.LogLevel` | Default `Error` |
| `OnStartup` | `func(ctx context.Context)` | Pre-`index.html` load. **Capture `ctx` here.** |
| `OnDomReady` | `func(ctx context.Context)` | After body onload. Safe for runtime calls touching the window. |
| `OnShutdown` | `func(ctx context.Context)` | Just before exit |
| `OnBeforeClose` | `func(ctx context.Context) bool` | Return `true` to prevent close |
| `CSSDragProperty` | `string` | Default `--wails-draggable` |
| `CSSDragValue` | `string` | Default `drag` |
| `EnableDefaultContextMenu` | `bool` | Browser right-click menu in production |
| `EnableFraudulentWebsiteDetection` | `bool` | |
| `DisablePanicRecovery` | `bool` | Default false |
| `Bind` | `[]interface{}` | **Instances** to expose to JS |
| `EnumBind` | `[]interface{}` | Enum metadata arrays — see `references/bindings.md` |
| `ErrorFormatter` | `func(error) any` | JSON-marshalled and returned to JS reject |
| `SingleInstanceLock` | `*options.SingleInstanceLock` | `{UniqueId, OnSecondInstanceLaunch}` |
| `DragAndDrop` | `*options.DragAndDrop` | `{EnableFileDrop, DisableWebViewDrop, CSSDropProperty, CSSDropValue}` |
| `Windows` | `*windows.Options` | Per-platform |
| `Mac` | `*mac.Options` | Per-platform |
| `Linux` | `*linux.Options` | Per-platform |
| `Debug` | `options.Debug` | `{OpenInspectorOnStartup}` |
| `BindingsAllowedOrigins` | `string` | Comma-separated; `*` wildcard allowed |

## `assetserver.Options`

| Field | Type | Notes |
|---|---|---|
| `Assets` | `fs.FS` (typically `embed.FS`) | Static assets. Wails finds the dir containing `index.html`. |
| `Handler` | `http.Handler` | Fallback for GETs not in `Assets` (returns `os.ErrNotExist`); always called for non-GET requests. |
| `Middleware` | `assetserver.Middleware` | `func(next http.Handler) http.Handler` |

Linux feature matrix (build tags):
- `webkit2_36` — non-GET request methods/headers/status
- `webkit2_40` — request bodies
- WebSockets unsupported on all platforms

## `windows.Options`

- `WebviewIsTransparent`, `WindowIsTranslucent` — translucency
- `BackdropType`: `windows.Auto | None | Acrylic | Mica | Tabbed` (Win 11 22621+)
- `ContentProtection`, `DisablePinchZoom`, `DisableWindowIcon`, `DisableFramelessWindowDecorations`
- `WebviewUserDataPath`, `WebviewBrowserPath` — fixed-version WebView2
- `Theme`: `windows.SystemDefault | Dark | Light`
- `CustomTheme: *windows.ThemeSettings` — `DarkModeTitleBar`, `DarkModeTitleText`, `DarkModeBorder`, `LightMode*`, `*Inactive` variants. Helper: `windows.RGB(r,g,b)`
- `Messages: *windows.Messages` — WebView2 installer strings
- `ZoomFactor float64`, `IsZoomControlEnabled bool`
- `ResizeDebounceMS uint16`
- `OnSuspend func()`, `OnResume func()`
- `WebviewGpuIsDisabled bool`, `EnableSwipeGestures bool`
- `WindowClassName string` (default `wailsWindow`)

## `mac.Options`

- `TitleBar *mac.TitleBar` — `{TitlebarAppearsTransparent, HideTitle, HideTitleBar, FullSizeContent, UseToolbar, HideToolbarSeparator}`. Presets: `mac.TitleBarDefault()`, `mac.TitleBarHidden()`, `mac.TitleBarHiddenInset()`
- `Appearance mac.AppearanceType`: `DefaultAppearance`, `NSAppearanceNameAqua`, `NSAppearanceNameDarkAqua`, `NSAppearanceNameVibrantLight`, plus accessibility variants
- `WebviewIsTransparent`, `WindowIsTranslucent`, `ContentProtection`
- `OnFileOpen func(path string)`, `OnUrlOpen func(url string)` — paired with `wails.json` `info.fileAssociations` / `info.protocols`
- `Preferences *mac.Preferences`: `TabFocusesLinks`, `TextInteractionEnabled`, `FullscreenEnabled` — values `mac.Enabled` / `mac.Disabled`
- `About *mac.AboutInfo`: `{Title, Message, Icon []byte}`

## `linux.Options`

- `Icon []byte` — window/iconified icon
- `WindowIsTranslucent bool`
- `WebviewGpuPolicy`: `WebviewGpuPolicyAlways` (default), `WebviewGpuPolicyOnDemand`, `WebviewGpuPolicyNever`
- `ProgramName string` — passed to GTK `g_set_prgname()`

## Minimal `main.go` skeleton

```go
package main

import (
    "context"
    "embed"
    "github.com/wailsapp/wails/v2"
    "github.com/wailsapp/wails/v2/pkg/options"
    "github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

type App struct{ ctx context.Context }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }
func (a *App) Greet(name string) string    { return "Hello " + name }

func main() {
    app := &App{}
    err := wails.Run(&options.App{
        Title:     "MyApp",
        Width:     1024,
        Height:    768,
        OnStartup: app.startup,
        AssetServer: &assetserver.Options{Assets: assets},
        Bind:      []interface{}{app},
    })
    if err != nil {
        println("Error:", err.Error())
    }
}
```
