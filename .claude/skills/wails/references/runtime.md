# Runtime API

The runtime is mirrored on both sides:

- **Go**: `import "github.com/wailsapp/wails/v2/pkg/runtime"`. Every function takes `ctx context.Context` (capture from `OnStartup` / `OnDomReady`).
- **JS**: `import {...} from "../wailsjs/runtime"` (typed) or `window.runtime.*` (untyped, always available).

Many APIs return `Promise<T>` on the JS side because they cross the IPC bridge.

## App-level

| Go | JS | Notes |
|---|---|---|
| `Hide(ctx)` | `Hide()` | macOS: NSApp hide. Win/Linux: same as `WindowHide` |
| `Show(ctx)` | `Show()` | |
| `Quit(ctx)` | `Quit()` | |
| `Environment(ctx) EnvironmentInfo` | `Environment()` | `{BuildType, Platform, Arch}` (Go) / lowercase (JS) |
| `ResetSignalHandlers()` | — | Linux only; reinstalls signal handlers with `SA_ONSTACK` for Go panic recovery in goroutines |

## Window

| Go | JS |
|---|---|
| `WindowSetTitle(ctx, string)` | `WindowSetTitle(title)` |
| `WindowFullscreen(ctx)` / `WindowUnfullscreen(ctx)` / `WindowIsFullscreen(ctx) bool` | same |
| `WindowCenter(ctx)` | `WindowCenter()` |
| `WindowReload(ctx)` / `WindowReloadApp(ctx)` | same |
| `WindowExecJS(ctx, js string)` | — (Go only; async, no return) |
| `WindowSetSystemDefaultTheme/SetLightTheme/SetDarkTheme(ctx)` | same (Windows only) |
| `WindowShow(ctx)` / `WindowHide(ctx)` | same |
| `WindowIsNormal(ctx) bool` | `WindowIsNormal(): Promise<boolean>` |
| `WindowSetSize(ctx, w, h int)` / `WindowGetSize(ctx) (int,int)` | `WindowSetSize(w,h)` / `WindowGetSize(): Promise<Size>` |
| `WindowSetMinSize(ctx, w, h)` / `WindowSetMaxSize(ctx, w, h)` | same. `(0,0)` to disable |
| `WindowSetAlwaysOnTop(ctx, bool)` | same |
| `WindowSetPosition(ctx, x, y)` / `WindowGetPosition(ctx) (int,int)` | same |
| `WindowMaximise` / `WindowUnmaximise` / `WindowIsMaximised` / `WindowToggleMaximise` | same |
| `WindowMinimise` / `WindowUnminimise` / `WindowIsMinimised` | same |
| `WindowSetBackgroundColour(ctx, R,G,B,A uint8)` | same. Windows: alpha must be 0 or 255 |
| `WindowPrint(ctx)` | `WindowPrint()` |

JS types: `interface Position { x: number; y: number }`, `interface Size { w: number; h: number }`.

## Dialog (Go only)

```go
runtime.OpenDirectoryDialog(ctx, OpenDialogOptions) (string, error)
runtime.OpenFileDialog(ctx, OpenDialogOptions) (string, error)
runtime.OpenMultipleFilesDialog(ctx, OpenDialogOptions) ([]string, error)
runtime.SaveFileDialog(ctx, SaveDialogOptions) (string, error)
runtime.MessageDialog(ctx, MessageDialogOptions) (string, error)
```

```go
type OpenDialogOptions struct {
    DefaultDirectory           string
    DefaultFilename            string
    Title                      string
    Filters                    []FileFilter
    ShowHiddenFiles            bool   // mac/lin
    CanCreateDirectories       bool   // mac
    ResolvesAliases            bool   // mac
    TreatPackagesAsDirectories bool   // mac
}

type FileFilter struct {
    DisplayName string  // "Image Files (*.jpg, *.png)"
    Pattern     string  // "*.jpg;*.png"   (semicolons)
}

type MessageDialogOptions struct {
    Type          DialogType  // InfoDialog | WarningDialog | ErrorDialog | QuestionDialog
    Title         string
    Message       string
    Buttons       []string    // mac only; up to 4
    DefaultButton string
    CancelButton  string      // mac only
}
```

Return strings on Windows: `"Ok"`, `"Cancel"`, `"Abort"`, `"Retry"`, `"Ignore"`, `"Yes"`, `"No"`, `"Try Again"`, `"Continue"`. Linux: `"Ok"`, `"Cancel"`, `"Yes"`, `"No"`. Question on Windows defaults to `"Yes"` — set `DefaultButton: "No"` to flip.

`SaveDialogOptions` is the same as `OpenDialogOptions` minus `ResolvesAliases`.

## Events

| Go | JS |
|---|---|
| `EventsOn(ctx, name, cb func(...interface{})) func()` | `EventsOn(name, cb): () => void` |
| `EventsOnce(ctx, name, cb) func()` | `EventsOnce(name, cb): () => void` |
| `EventsOnMultiple(ctx, name, cb, counter int) func()` | `EventsOnMultiple(name, cb, counter): () => void` |
| `EventsOff(ctx, name, ...additional)` | `EventsOff(name, ...additional)` |
| `EventsOffAll(ctx)` | `EventsOffAll()` |
| `EventsEmit(ctx, name, ...optionalData)` | `EventsEmit(name, ...optionalData)` |

Cross-language: a JS `EventsEmit` reaches Go listeners and vice versa. The `On*` functions return an unsubscribe.

Built-in: `wails:file-drop` fires when `DragAndDrop.EnableFileDrop` is true. Payload: `(x, y, paths []string)`.

## Log

Levels low → high: Trace, Debug, Info, Warning, Error, Fatal. JS numeric: 1 Trace, 2 Debug, 3 Info, 4 Warning, 5 Error.

| Go | JS |
|---|---|
| `LogPrint(ctx, msg)` / `LogPrintf(ctx, fmt, ...)` | `LogPrint(msg)` |
| `LogTrace`/`LogDebug`/`LogInfo`/`LogWarning`/`LogError`/`LogFatal` (each with `*f` variant) | `LogTrace`/`LogDebug`/`LogInfo`/`LogWarning`/`LogError`/`LogFatal` |
| `LogSetLogLevel(ctx, logger.LogLevel)` | `LogSetLogLevel(n)` |

Custom logger (`github.com/wailsapp/wails/v2/pkg/logger`):

```go
type Logger interface {
    Print(message string)
    Trace(message string)
    Debug(message string)
    Info(message string)
    Warning(message string)
    Error(message string)
    Fatal(message string)
}
```

## Browser

`BrowserOpenURL(ctx, url string)` / `BrowserOpenURL(url)` — opens in the user's default browser.

## Screen

`ScreenGetAll(ctx) []Screen` / `ScreenGetAll(): Promise<Screen[]>`:

```go
type Screen struct {
    IsCurrent bool
    IsPrimary bool
    Width     int
    Height    int
}
```

## Menu (Go only)

```go
runtime.MenuSetApplicationMenu(ctx, *menu.Menu)
runtime.MenuUpdateApplicationMenu(ctx)
```

Building menus (`github.com/wailsapp/wails/v2/pkg/menu` + `pkg/menu/keys`):

```go
m := menu.NewMenu()
file := m.AddSubmenu("File")
file.AddText("Open", keys.CmdOrCtrl("o"), func(cd *menu.CallbackData) { /* ... */ })
file.AddSeparator()
file.AddText("Quit", keys.CmdOrCtrl("q"), func(cd *menu.CallbackData) { runtime.Quit(ctx) })

// macOS standard menus
m.Append(menu.AppMenu())
m.Append(menu.EditMenu())   // Cmd+C/V/Z

runtime.MenuSetApplicationMenu(ctx, m)
```

`MenuItem`:
```go
type MenuItem struct {
    Label       string
    Role        Role               // macOS roles
    Accelerator *keys.Accelerator
    Type        Type
    Disabled    bool
    Hidden      bool
    Checked     bool
    SubMenu     *Menu
    Click       Callback           // func(*menu.CallbackData)
}
```

## Clipboard

| Go | JS |
|---|---|
| `ClipboardGetText(ctx) (string, error)` | `ClipboardGetText(): Promise<string>` |
| `ClipboardSetText(ctx, text string) error` | `ClipboardSetText(text): Promise<boolean>` |

Text only.

## Drag-and-Drop

Enable in `options.App`:

```go
DragAndDrop: &options.DragAndDrop{
    EnableFileDrop:     true,
    DisableWebViewDrop: false,
    CSSDropProperty:    "--wails-drop-target",
    CSSDropValue:       "drop",
},
```

| Go | JS |
|---|---|
| `OnFileDrop(ctx, func(x,y int, paths []string))` | `OnFileDrop(cb, useDropTarget: boolean)` |
| `OnFileDropOff(ctx)` | `OnFileDropOff()` |

When `useDropTarget` is true, JS auto-toggles a `wails-drop-target-active` class on elements whose CSS sets `CSSDropProperty: CSSDropValue`. Alternative: subscribe to the `wails:file-drop` event via `EventsOn`.

## Notifications

`InitializeNotifications(ctx) error`, `IsNotificationAvailable(ctx) bool`, plus send/dismiss with action buttons and reply text fields. Available in both Go and JS runtimes — see `website/docs/reference/runtime/notification.mdx` upstream for the full options struct.
