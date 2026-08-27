# Runtime API

There is no `runtime` package and no context threading. The Go side calls methods on the application, its managers and its windows; the frontend imports `@wailsio/runtime`.

- **Go**: `app := application.New(...)` or `application.Get()`, then `app.<Manager>.<Method>` / `window.<Method>`.
- **JS**: `import { Events, Window, Browser, Dialogs, Clipboard, Screens, System, Application } from "@wailsio/runtime"`.

Everything on the JS side crosses the IPC bridge and returns a `Promise`.

## Managers on `*application.App`

`Window` · `Event` · `Dialog` · `Menu` · `ContextMenu` · `Clipboard` · `Browser` · `Screen` · `SystemTray` · `KeyBinding` · `GlobalShortcut` · `Autostart` · `Env`

Plus, on the app itself: `Run() error`, `Quit()`, `Hide()`, `Show()`, `SetIcon([]byte)`, `Context() context.Context`, `Config() Options`, `Capabilities()`, `GetPID()`, `RegisterService(Service)`, `OnShutdown(func())`.

## Windows

```go
window := app.Window.NewWithOptions(application.WebviewWindowOptions{...})
window.SetTitle("New Title")
```

| Manager method | Notes |
|---|---|
| `New()` / `NewWithOptions(opts)` | Returns `*WebviewWindow` |
| `Current()` | The focused window (or the first one) |
| `Get(name)` / `GetByName(name)` / `GetByID(id)` | `(Window, bool)` |
| `GetAll()` | |
| `Remove(id)` / `RemoveByName(name)` | |
| `OnCreate(func(Window))` | |

`*WebviewWindow` methods, mirrored on the JS `Window` object unless noted:

- **Title & size**: `SetTitle`, `SetSize`, `Size`, `Width`, `Height`, `SetMinSize`, `SetMaxSize`, `SetResizable`, `Resizable`, `EnableSizeConstraints`, `DisableSizeConstraints`
- **Position**: `SetPosition`, `Position`, `SetRelativePosition`, `RelativePosition`, `Center`, `GetScreen`
- **State**: `Show`, `Hide`, `Focus`, `IsFocused`, `Close`, `Minimise`, `UnMinimise`, `IsMinimised`, `Maximise`, `UnMaximise`, `IsMaximised`, `Restore`, `Fullscreen`, `UnFullscreen`, `ToggleFullscreen`, `IsFullscreen`
- **Content**: `Reload`, `ForceReload`, `SetURL`, `SetZoom`, `GetZoom`, `SetBackgroundColour`, `SetAlwaysOnTop`, `SetFrameless`, `OpenDevTools`, `ExecJS` (Go only), `Name`
- **Events**: `OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent))`, `EmitEvent`

`app.Window.Current()` returns nil when nothing is focused, so a single-window app is usually clearer keeping its own `*WebviewWindow`.

## Events

```go
app.Event.Emit("event-name", data)
app.Event.On("event-name", func(e *application.CustomEvent) { _ = e.Data })
app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl,
    func(e *application.ApplicationEvent) { _ = e.Context().URL() })
```

```ts
import { Events } from "@wailsio/runtime";
const off = Events.On("event-name", (event) => console.log(event.data));
Events.Emit("action", data);
```

- One bus for Go and JS: an event emitted on either side reaches listeners on both.
- `Emit(name, data ...any)`: one argument becomes `Data`; several become the argument slice. **The JS callback takes an event object, not the payload** — read `event.data` (and `event.sender`, the emitting window's name).
- `On` returns an unsubscribe function on both sides. Also `Once`, `OnMultiple(name, cb, n)`, `Off(...names)`, `OffAll()`.
- `EmitEvent(*CustomEvent)` and `RegisterApplicationEventHook` let a hook cancel an event before it is dispatched.
- **Application events**: `events.Common.ApplicationStarted`, `…ApplicationOpenedWithFile` (`e.Context().Filename()`), `…ApplicationLaunchedWithUrl` (`e.Context().URL()`), plus dark-mode and platform-specific ones under `events.Mac`, `events.Windows`, `events.Linux`.
- **Window events**: `events.Common.WindowShow`, `…WindowClosing`, `…WindowDidResize`, `…WindowDidMove`, `…WindowFocus`, `…WindowLostFocus`, `…WindowMaximise`, `…WindowMinimise`, `…WindowFullscreen`, `…WindowFilesDropped`, `…WindowRuntimeReady`, `…WindowDPIChanged`, and the rest.

Register the URL/file handlers **before** `app.Run()` — a launch that carries one delivers it as the application starts.

## Dialogs

```go
path, err := app.Dialog.OpenFile().
    CanChooseFiles(false).
    CanChooseDirectories(true).
    SetTitle("Select a folder").
    PromptForSingleSelection()
```

- `OpenFile()` / `OpenFileWithOptions(*OpenFileDialogOptions)` → builder, then `PromptForSingleSelection() (string, error)` or `PromptForMultipleSelection() ([]string, error)`. Builder methods: `CanChooseFiles`, `CanChooseDirectories`, `CanCreateDirectories`, `AllowsOtherFileTypes`, `ShowHiddenFiles`, `HideExtension`, `CanSelectHiddenExtension`, `TreatsFilePackagesAsDirectories`, `ResolvesAliases`, `AddFilter(name, "*.jpg;*.png")`, `SetTitle`, `SetMessage`, `SetButtonText`, `SetDirectory`, `AttachToWindow`.
- **There is no separate directory dialog** — it is `OpenFile()` with `CanChooseDirectories(true)` and `CanChooseFiles(false)`.
- `SaveFile()` / `SaveFileWithOptions(...)` → the same shape.
- `Info()`, `Question()`, `Warning()`, `Error()` → `*MessageDialog`: `SetTitle`, `SetMessage`, `AddButton`, `Show()`.

JS: `Dialogs.Info/Warning/Error/Question(options)`, `Dialogs.OpenFile(options)`, `Dialogs.SaveFile(options)` — option keys are capitalised (`{ Title, Message, AllowsMultipleSelection }`).

## Menus

```go
menu := app.Menu.New()
menu.AddRole(application.AppMenu)

fileMenu := menu.AddSubmenu("File")
fileMenu.Add("Save").SetAccelerator("CmdOrCtrl+S").OnClick(func(*application.Context) { … })

menu.AddRole(application.EditMenu)
menu.AddRole(application.WindowMenu)

app.Menu.Set(menu)
```

- `*Menu`: `Add(label) *MenuItem`, `AddSeparator()`, `AddCheckbox(label, checked)`, `AddRadio(label, on)`, `AddSubmenu(label) *Menu`, `AddRole(Role) *Menu`, `Append`/`Prepend(*Menu)`, `FindByLabel`, `FindByRole`, `ItemAt`, `RemoveMenuItem`, `Clone`, `Clear`, `Update`, `Destroy`.
- `*MenuItem`: `OnClick(func(*application.Context))`, `SetAccelerator("CmdOrCtrl+S")`, `RemoveAccelerator`, `SetLabel`, `SetEnabled`, `SetChecked`, `SetHidden`, `SetTooltip`, `SetBitmap`, `SetRole`, plus the matching getters. All the setters return the item, so they chain.
- Roles (`application.AppMenu`, `EditMenu`, `ViewMenu`, `WindowMenu`, `HelpMenu`, `ServicesMenu`, and item-level `About`, `Quit`, `Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `SelectAll`, `Reload`, `ForceReload`, `ToggleFullscreen`, `OpenDevTools`, `ZoomIn`, `ZoomOut`, `ResetZoom`, `Minimise`, `Zoom`, `CloseWindow`, `Hide`, `HideOthers`, `ShowAll`, `BringAllToFront`, …) build the platform's standard items. There are also `New*MenuItem()` constructors for each.
- `app.Menu.Set(menu)` installs the application menu; `app.Menu.ShowAbout()` opens the About box built from `Options.Name`/`Description`/`Icon`; `app.Menu.GetApplicationMenu()` reads it back.
- Windows/Linux: a window uses the application menu only with `UseApplicationMenu: true`, or its own via `window.SetMenu`.

`app.ContextMenu.New()` / `Add(name, menu)` registers context menus; web content opens one by setting `--custom-contextmenu` in CSS.

## System tray

```go
tray := app.SystemTray.New()
tray.SetIcon(iconBytes)
tray.SetLabel("My App")
tray.SetMenu(menu)
tray.AttachWindow(window).WindowOffset(5)
```

Pair it with `MacOptions{ActivationPolicy: application.ActivationPolicyAccessory}` for a dockless app.

## Everything else

| | Go | JS |
|---|---|---|
| Clipboard | `app.Clipboard.SetText(s) bool`, `.Text() (string, bool)` | `Clipboard.SetText`, `Clipboard.Text` |
| Browser | `app.Browser.OpenURL(url) error` | `Browser.OpenURL(url)` |
| Screens | `app.Screen.GetAll/GetPrimary/GetByID/GetByIndex`, DIP↔physical conversions | `Screens.GetAll/GetPrimary/GetCurrent/GetByID/GetByIndex` |
| Environment | `app.Env.Info()`, `.IsDarkMode()`, `.GetAccentColor()`, `.OpenFileManager(path, selectFile)`, `.HasFocusFollowsMouse()` | `System.Environment()`, `System.IsDarkMode()`, and the synchronous `System.IsMac/IsWindows/IsLinux/IsMobile/IsDesktop/IsDebug/IsARM64/…` |
| Key bindings | `app.KeyBinding.Add(accel, func(Window))`, `.Remove`, `.GetAll` | — |
| Global shortcuts | `app.GlobalShortcut.Register(accel, func())`, `.Unregister`, `.UnregisterAll`, `.IsRegistered`, `.GetAll` | — |
| Autostart | `app.Autostart.*` | — |
| Application | `app.Hide/Show/Quit` | `Application.Hide/Show/Quit` |

JS-only: `WML` (declarative `wml-event` / `wml-window` attributes on elements), `Call` (raw binding calls), `Create` (model reconstruction, used by generated code), `Stream`/`JSONStream`/`WailsSocket`, `Updater`, `setTransport`/`getTransport` for a custom IPC transport.
