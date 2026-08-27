# Services and bindings

## A service is a plain struct

```go
type GreetService struct{}

func (g *GreetService) Greet(name string) string {
    return "Hello " + name
}
```

```go
app := application.New(application.Options{
    Services: []application.Service{
        application.NewService(&GreetService{}),
    },
})
```

- `NewService[T](*T)` requires a **pointer to a concrete named type**. Anything else produces an invalid `Service`.
- `NewServiceWithOptions(&svc, application.ServiceOptions{...})` sets `Name` (for logs), `Route` (see below) or `MarshalError`.
- `app.RegisterService(...)` registers one after `application.New` — useful when the service needs the `*application.App` as a constructor argument.
- Services receive startup in registration order, `Options.Services` first; shutdown is the reverse.

## Lifecycle interfaces

All optional, all matched by name, and **none of them is bound to the frontend** (nor is `ServeHTTP`):

```go
func (s *S) ServiceName() string { return "greeter" }

func (s *S) ServiceStartup(ctx context.Context, options application.ServiceOptions) error
func (s *S) ServiceShutdown() error
```

`ServiceStartup`'s context stays valid for the life of the application and is cancelled just before shutdown. Returning an error aborts startup: `App.Run` returns it wrapped with the service's name, and services already started are shut down.

There is no `OnDomReady`. What needs a loaded window hangs off `window.OnWindowEvent(events.Common.WindowRuntimeReady, …)`.

## Reaching the app from a service

There is no context to capture. Pick one:

```go
// 1. Constructor injection — the clearest.
func NewMyService(app *application.App) *MyService { return &MyService{app: app} }
app := application.New(application.Options{})
app.RegisterService(application.NewService(NewMyService(app)))

// 2. A field set before Run, when the service must exist before the app does.
svc.app, svc.window = app, window

// 3. application.Get(), the package-level singleton.
```

## Serving HTTP from a service

A service that implements `http.Handler` and is registered with `ServiceOptions{Route: "/api"}` is mounted on the internal asset server at that prefix. The frontend reaches it with an ordinary `fetch("/api/...")`.

## What the generator writes

```bash
wails3 generate bindings -d frontend/bindings -ts
```

```
frontend/bindings/github.com/you/yourapp/
├── greetservice.ts
├── models.ts
└── index.ts
```

The directory under the output root is the Go **import path**, so a module named `github.com/you/yourapp` nests five levels deep. That is not configurable; a project that finds the import noisy re-exports it from a module of its own.

```ts
import { Greet } from "./bindings/github.com/you/yourapp/greetservice";
const result = await Greet("World");
```

- One file per service, one exported function per bound method.
- `models.ts` holds a class per Go struct the methods name, with `createFrom` for reconstructing one from JSON. `-i` emits interfaces instead.
- `index.ts` re-exports the services under their own names plus every model. `-noindex` skips it.
- Every generated file imports `@wailsio/runtime`; `-b` inlines a bundled copy instead, for a frontend with no package manager.
- Calls go out by numeric ID (`$Call.ByID(2132153547, …)`). `-names` switches to names, which is slower to dispatch but survives a method being renamed in only one half of a build.

## Type mapping

| Go | TS |
|---|---|
| `string`, `bool`, numeric | `string`, `boolean`, `number` |
| `[]byte` | `string` — **base64**, in both directions |
| `[]T` | `T[]` |
| `map[K]V` | `{ [_ in K]?: V }` — values are optional, because a JSON object may omit any key |
| `*T` | `T \| null` |
| `time.Time` | `string` (or `Date` with `-time-type Date`) |
| struct | a class in `models.ts` |
| `any` | `any` |

Rules that survive from v2: methods must be **exported**; struct fields need `json` tags to appear at all; anonymous nested structs aren't supported — name the inner type; a **first `context.Context` parameter is auto-injected** and dropped from the JS signature.

## Promises, cancellation and errors

Every generated method returns a `CancellablePromise<T>` — a real `Promise` with `.cancel()` and `.oncancelled`. Cancelling one asks the Go side to abandon the call; a method whose first parameter is a `context.Context` sees that context cancelled.

A method returning `(T, error)` rejects with a `RuntimeError` whose `message` is the Go error string. Shape it differently with `Options.MarshalError` or per-service `ServiceOptions.MarshalError`; both must return valid JSON or `nil` to fall through.

## Typed events

```go
func init() {
    application.RegisterEvent[string]("time")
}
```

Registering an event name with its data type does two things: `app.Event.Emit` validates against it (a mismatch is reported to the error handler and cancels the event), and the binding generator emits TS types for it, so `Events.On("time", e => e.data)` is typed. `-noevents` turns the generation off. Registering a name that is already a system event panics.
