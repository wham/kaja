# Bindings (Go ↔ JS)

`Bind: []interface{}{ app, &otherStruct{} }` in `options.App` exposes **instances** to JS. Wails reflects over each value, picks up exported methods, and emits JS wrappers + TypeScript declarations.

## Generated tree

```
frontend/wailsjs/                    # or wherever wailsjsdir points
├── go/
│   ├── <pkg>/<Struct>.js            # function wrappers
│   ├── <pkg>/<Struct>.d.ts          # TS declarations
│   └── models.ts                    # Go struct → TS class/interface
└── runtime/
    ├── runtime.js
    └── runtime.d.ts
```

Regeneration is automatic on `wails dev` and `wails build`. Manual: `wails generate module`. Don't commit this tree.

## Method conventions

- Methods must be **exported** (uppercase first letter).
- If the first parameter is `context.Context`, Wails injects the app context — the JS-facing signature drops it.
- Return shapes Wails understands: `(T)`, `(T, error)`, `error`. Errors → JS `Promise` reject; success values → resolve.
- Argument and return types: scalars, slices, maps, structs.
- Struct fields **must have a `json` tag** to appear in generated TS.
- Anonymous nested structs are not supported.
- Pointers to structs are fine.

```go
type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

type App struct{ ctx context.Context }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// JS: Greet(p: main.Person): Promise<string>
func (a *App) Greet(p Person) (string, error) {
    if p.Name == "" {
        return "", fmt.Errorf("missing name")
    }
    return "Hello " + p.Name, nil
}

// JS: TouchedAt(): Promise<string>      // ctx auto-injected
func (a *App) TouchedAt(ctx context.Context) string {
    return time.Now().Format(time.RFC3339)
}
```

## JS usage

```js
import { Greet } from "../wailsjs/go/main/App";
import { main } from "../wailsjs/go/models";

const p = new main.Person();
p.name = "Ada"; p.age = 36;

Greet(p)
  .then(console.log)
  .catch(err => console.error(err));   // err is whatever ErrorFormatter returned
```

Internally the wrapper calls `window.go.<pkg>.<Struct>.<Method>(...)` — the global is also there if you need to call by name.

## Custom error format

```go
options.App{
    ErrorFormatter: func(err error) any {
        var c *MyCodedError
        if errors.As(err, &c) {
            return map[string]any{"code": c.Code, "message": c.Message}
        }
        return err.Error()
    },
}
```

The returned value is JSON-marshalled and becomes the JS rejection.

## Enum binding

Wails can emit TS string-union or class enums for Go-defined enums when you supply metadata.

```go
type Status int
const (
    StatusActive Status = iota
    StatusPaused
    StatusArchived
)

var AllStatuses = []struct {
    Value  Status
    TSName string
}{
    {StatusActive, "ACTIVE"},
    {StatusPaused, "PAUSED"},
    {StatusArchived, "ARCHIVED"},
}

options.App{
    EnumBind: []interface{}{ AllStatuses },
}
```

The metadata appears in `models.ts`.

## TS output style

`wails.json`:

```json
{
  "bindings": {
    "ts_generation": {
      "prefix": "",
      "suffix": "",
      "outputType": "classes"   // or "interfaces"
    }
  }
}
```

`classes` (default) emits constructable wrappers: `new main.Person()`. `interfaces` emits plain `export interface` types — pair with frontend code that builds objects via spread/literal.

## When bindings look stale

- Run `wails generate module` to force regen
- Confirm `wailsjsdir` in `wails.json` is pointing where the frontend imports from
- A method without `json` tags on its struct types will silently produce empty TS
- A method whose only return is a non-error type other than `(T)` or `(T, error)` won't be exposed
