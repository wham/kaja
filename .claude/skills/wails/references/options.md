# Options

## `application.Options`

```go
app := application.New(application.Options{
    Name:        "My App",
    Description: "A program that does X",
    Icon:        iconBytes,
    Services: []application.Service{
        application.NewService(&GreetService{}),
    },
    Assets: application.AssetOptions{
        Handler: application.AssetFileServerFS(assets),
    },
    LogLevel: slog.LevelError,
    Mac: application.MacOptions{
        ApplicationShouldTerminateAfterLastWindowClosed: true,
    },
})
```

### Identity and content

| Field | Notes |
|---|---|
| `Name string` | Used by the default About box, the `About` menu role's label, and the app menu |
| `Description string` | The About box's message |
| `Icon []byte` | The About box's icon; `app.SetIcon` changes it later |
| `Services []Service` | The bound services. `App.RegisterService` adds more before `Run` |
| `Assets AssetOptions` | See below |
| `Flags map[string]any` | Arbitrary values readable from the frontend |

### `AssetOptions`

| Field | Notes |
|---|---|
| `Handler http.Handler` | Serves everything to the webview |
| `Middleware Middleware` | `func(next http.Handler) http.Handler`, inserted **before** Wails' own middleware. `ChainMiddleware(...)` composes several |
| `DisableLogging bool` | The asset server logs every request otherwise |

Two constructors:

- `AssetFileServerFS(fs.FS)` — serves the FS, locating the directory that holds `index.html` inside it, so `//go:embed all:frontend/dist` works unchanged. In a build **without** `-tags production` it proxies to `FRONTEND_DEVSERVER_URL` when that is set.
- `BundledAssetFileServer(fs.FS)` — the same, plus `/wails/runtime.js` from the embedded runtime. Use it when the frontend loads the runtime from a script tag rather than from the npm package.

### Lifecycle and errors

| Field | Notes |
|---|---|
| `OnShutdown func()` | Runs before termination; shutdown blocks on it. `App.OnShutdown` registers more |
| `PostShutdown func()` | After shutdown, just before the process ends |
| `ShouldQuit func() bool` | Return false to refuse a quit |
| `PanicHandler func(*PanicDetails)` | |
| `ErrorHandler func(error)`, `WarningHandler func(string)` | Default is to log |
| `MarshalError func(error) []byte` | JSON shape for errors returned by service methods; per-service `ServiceOptions.MarshalError` wins |
| `DisableDefaultSignalHandler bool` | |

### Logging, input, platform

| Field | Notes |
|---|---|
| `Logger *slog.Logger`, `LogLevel slog.Level` | Wails' own logging, not the app's |
| `KeyBindings map[string]func(window Window)` | Application-wide; windows may add their own |
| `SingleInstance *SingleInstanceOptions` | Second launches hand their arguments to the first |
| `FileAssociations []string` | Extensions, with the dot: `[]string{".txt"}` |
| `BindAliases map[uint32]uint32` | Alias IDs for bound methods |
| `RawMessageHandler func(window Window, message string, originInfo *OriginInfo)` | |
| `Transport Transport` | Replace the HTTP-fetch IPC with your own (WebSocket, postMessage, …) |
| `Server ServerOptions` | Only with `-tags server`: host, port, timeouts, TLS, WebSocket origins |

### `MacOptions`

| Field | Notes |
|---|---|
| `ActivationPolicy` | `ActivationPolicyRegular` (default), `…Accessory` (no dock icon — systray apps), `…Prohibited` |
| `ApplicationShouldTerminateAfterLastWindowClosed bool` | v2's behaviour; **off by default in v3** |

### `WindowsOptions`

`WndClass`, `WndProcInterceptor`, `DisableQuitOnLastWindowClosed`, `WebviewUserDataPath`, `WebviewBrowserPath`, `EnabledFeatures`/`DisabledFeatures`/`AdditionalBrowserArgs` (global — WebView2 shares one environment), `UseVisualHosting` (forces DComp hosting; fixes multi-second stalls over some RDP clients).

### `LinuxOptions`

`DisableQuitOnLastWindowClosed`, `ProgramName` (GTK's `g_set_prgname`, for window grouping and desktop icons).

## `application.WebviewWindowOptions`

```go
window := app.Window.NewWithOptions(application.WebviewWindowOptions{
    Title:            "My App",
    Width:            1440,
    Height:           900,
    MinWidth:         400,
    MinHeight:        270,
    BackgroundColour: application.NewRGB(27, 38, 54),
    Mac:              application.MacWindow{TitleBar: application.MacTitleBarHiddenInset},
    URL:              "/",
})
```

### Geometry

`Width`, `Height`, `MinWidth`, `MinHeight`, `MaxWidth`, `MaxHeight`, `X`, `Y`, `Screen *Screen`, `InitialPosition` (`WindowCentered` is the zero value; `WindowXY` uses `X`/`Y`), `StartState` (`WindowStateNormal`/`Minimised`/`Maximised`/`Fullscreen`), `Hidden`, `DisableResize`, `AlwaysOnTop`.

### Content

`Name` (a window's identifier for `app.Window.Get`), `Title`, `URL`, `HTML`, `JS`, `CSS`, `Zoom`, `ZoomControlEnabled`, `BackgroundType` (`Solid`/`Transparent`/`Translucent`), `BackgroundColour RGBA`.

### Chrome and behaviour

`Frameless`, `MinimiseButtonState` / `MaximiseButtonState` / `CloseButtonState` / `FullscreenButtonState` (`ButtonEnabled`/`ButtonDisabled`/`ButtonHidden`), `UseApplicationMenu`, `DevToolsEnabled`, `OpenInspectorOnStartup`, `DefaultContextMenuDisabled`, `KeyBindings`, `IgnoreMouseEvents`, `ContentProtectionEnabled`, `HideOnFocusLost`, `HideOnEscape`, `EnableFileDrop`, `Permissions map[PermissionType]Permission`, `AllowSimpleEventEmit` (security-sensitive — see the field's own comment).

### `MacWindow`

| Field | Notes |
|---|---|
| `TitleBar MacTitleBar` | Presets: `MacTitleBarDefault`, `MacTitleBarHidden`, `MacTitleBarHiddenInset`, `MacTitleBarHiddenInsetUnified`. The struct is `AppearsTransparent`, `Hide`, `HideTitle`, `FullSizeContent`, `UseToolbar`, `HideToolbarSeparator`, `ShowToolbarWhenFullscreen`, `ToolbarStyle` |
| `Backdrop MacBackdrop` | `MacBackdropNormal` / `MacBackdropTranslucent` |
| `Appearance MacAppearanceType` | e.g. `NSAppearanceNameDarkAqua` |
| `InvisibleTitleBarHeight int` | A draggable strip at the top of a title-bar-less window |
| `DisableShadow`, `CornerType`, `CornerRadius` | Frameless window shape |
| `WindowLevel MacWindowLevel` | `normal`, `floating`, `status`, … |
| `CollectionBehavior MacWindowCollectionBehavior` | Spaces and fullscreen, OR-able |
| `TabbingMode MacWindowTabbingMode` | |
| `WindowClass MacWindowClass`, `PanelPreferences` | `NSWindow` or `NSPanel` |
| `LiquidGlass MacLiquidGlass` | |
| `WebviewPreferences MacWebviewPreferences` | `optional.Bool` fields: back/forward gestures, magnification, autoplay, `MinimumFontSize`, `ApplicationNameForUserAgent`, … |
| `EnableFraudulentWebsiteWarnings bool` | |
| `DisableEscapeExitsFullscreen bool` | Let web content handle Esc while fullscreen |
| `EventMapping map[events.WindowEventType]events.WindowEventType` | |

There is no position to set for the traffic lights; `MacTitleBar` is the whole of what the framework offers. Moving them means AppKit code of your own.

### `WindowsWindow`

`BackdropType`, `Theme` + `CustomTheme`, `DisableIcon`, `DisableFramelessWindowDecorations`, `WindowMask` + `WindowMaskDraggable`, `NonClientRegionSupport`, `WebView2CompositionHosting`.

### `LinuxWindow`

`Icon []byte`, `WindowIsTranslucent`, `WebviewGpuPolicy` (`Always`/`OnDemand`/`Never`), `WindowDidMoveDebounceMS`.
