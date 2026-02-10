## Guidelines

- See [Development](#development) for instructions how to run and test.
- Only add code comments for really tricky parts; otherwise keep it clean.
- If API is called "getConfiguration", use "configuration" not "config" in code.
- Don't run `go build` directly; use `scripts/server` and/or `scripts/desktop`. Kill `scripts/server` when done. Make sure the server port is not in use.
- The UI is using https://primer.style/product/getting-started/react/. Use out-of-the-box Primer components as much as possible. Avoid custom styling unless absolutely necessary.
- Don't update generated files directly; they will be overwritten. See [Generated Files](#generated-files).
- When I prompt you to make changes that are radically different from what's documented here, please update this file accordingly.
- Don't commit changes to `kaja.json`
- Use past tense in pull request titles and commit messages (e.g., "Fix bug" → "Fixed bug").
- Use capitalized "Kaja" for user-facing labels (titles, headings, UI text). Keep lowercase "kaja" for code, terminal commands, and file paths.
- Use pure Primer when possible, avoid custom wrappers and abstractions.
- Ask me before creating custom UI components; prefer direct use of Primer components.
- Keep pull-request descriptions super short - one or two sentences summarizing the change.

## Development

Run the development server (starts on port 41520 with the demo workspace):

```
scripts/server
```

Run tests:

```
(cd ui && npm test -- run)       # Frontend tests (Vitest)
(cd ui && npm run tsc)           # TypeScript type checking
(cd server && go test ./... -v)  # Backend tests
```

Format code:

```
(cd ui && npm run prettier)      # Prettier (2-space indent, 160 char width)
```

Build and run the desktop app (macOS):

```
scripts/desktop
```

## Tech Stack

- **Backend:** Go 1.24, Twirp RPC framework, esbuild for bundling
- **Frontend:** React 19, TypeScript 5, Monaco editor, styled-components
- **UI library:** [Primer React](https://primer.style/product/getting-started/react/) (GitHub's design system)
- **Proto tooling:** protobuf-ts (TypeScript), protoc-gen-go + protoc-gen-twirp (Go)
- **Testing:** Vitest (frontend), `go test` (backend)
- **Desktop:** Wails v2 (Go + webview)
- **Deployment:** Docker (kajatools/kaja on Docker Hub)

## Directory Structure

```
/
├── desktop/          # Desktop application (Wails framework)
├── server/           # Backend server (Go) - serves both web and desktop
├── ui/               # Frontend UI (React/TypeScript)
├── workspace/        # Demo workspace with example proto definitions
├── scripts/          # Build and development scripts
└── docs/             # Documentation
```

### Build Directories

There are multiple `build/` directories, each serving a different purpose:

| Directory                 | Purpose                                                                                  | Gitignored |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| `/server/build/`          | Protoc plugins (protoc-gen-\*) and bundled UI assets (main.js, main.css, monaco workers) | Yes        |
| `/desktop/build/`         | Platform files (app icons, Info.plist) - tracked in git                                  | No         |
| `/desktop/build/bin/`     | Desktop executable binaries                                                              | Yes        |
| `/desktop/frontend/dist/` | Frontend distribution for desktop (copied from server/build)                             | Yes        |
| `$TMPDIR/kaja/`           | Compilation temp folders (auto-cleaned after 60 min)                                     | N/A        |

### Development vs Production Builds

The server uses Go build tags to switch between development and production modes:

**Development** (`-tags development`):

- `server/assets_development.go` is used
- Reads UI files from filesystem at runtime
- Calls `ui.BuildForDevelopment()` to rebuild assets on startup
- Allows hot-reload during development

**Production** (default, no tags):

- `server/assets_production.go` is used
- All assets are embedded in the binary via `//go:embed`
- No filesystem access needed for serving UI
- Single self-contained binary

### Server vs Desktop

Both share the same backend code but differ in how they're packaged:

**Server (Web)**:

- Single Go binary with embedded React UI
- Serves HTTP API on port 41520
- Run with: `scripts/server`
- Assets from `/server/build/` and `/server/static/`

**Desktop (Wails)**:

- Uses Wails framework (Go + webview)
- Embeds frontend via `//go:embed all:frontend/dist`
- Frontend files copied from server build to `/desktop/frontend/dist/`
- Native window and file dialogs
- Run with: `scripts/desktop`

### Source Directories

**`/ui/`** - React/TypeScript frontend:

- `src/*.tsx` - React components
- `src/server/` - Generated proto client code (from `/server/proto/api.proto`)
- `src/wailsjs/` - Generated Wails bindings (auto-generated)

**`/server/`** - Go backend:

- `cmd/server/` - Main server application
- `cmd/build-ui/` - Tool to bundle React UI with esbuild
- `pkg/api/` - Generated proto code (Go)
- `proto/api.proto` - API service definition (source of truth)
- `static/` - Static files (index.html, favicon)

**`/desktop/`** - Wails desktop app:

- `main.go` - Wails app entry point
- `frontend/dist/` - Copied from server build (gitignored)

**`/workspace/`** - Example workspace for development and testing:

- This is a demo workspace that developers use to test kaja
- `kaja.json` - Configuration file defining demo projects hosted on kaja.tools:
  - quirks, users, teams services (both gRPC and Twirp protocols)
- `quirks/proto/`, `users/proto/`, `teams/proto/` - Proto files for each service
- Run `scripts/demo-protos` to update proto files from kaja-tools/website
- The `scripts/server` script starts kaja with this workspace by default

### Code Generation Flow

```
/server/proto/api.proto
         │
         ├──→ [protoc + protoc-gen-go/twirp] → /server/pkg/api/*.go
         │
         └──→ [protoc + protoc-gen-ts]       → /ui/src/server/*.ts
                                                      │
                                                      v
                                    go run cmd/build-ui/main.go (esbuild)
                                                      │
                                                      v
                                            /server/build/
                                          (main.js, main.css, workers)
                                                      │
                         ┌────────────────────────────┼────────────────────────────┐
                         │                            │                            │
                         v                            v                            v
              Server (embedded)           Desktop (copied to             Docker (embedded)
                                         /desktop/frontend/dist)
```

### Generated Files

Do not edit these files directly; they are overwritten by code generation:

| Files | Generator |
| ----- | --------- |
| `server/pkg/api/api.pb.go` | protoc + protoc-gen-go |
| `server/pkg/api/api.twirp.go` | protoc + protoc-gen-twirp |
| `ui/src/server/api.ts`, `ui/src/server/api.client.ts` | protoc + protoc-gen-ts |
| `ui/src/wailsjs/**` | Wails framework |
| `server/build/` (main.js, main.css, workers) | esbuild via `cmd/build-ui` |

To regenerate proto code after changing `server/proto/api.proto`, `scripts/server` handles this automatically. To regenerate manually:

```
(cd ui && npm run protoc)           # TypeScript client
(cd server && go generate ./...)    # Go server (if using go:generate directives)
```

## Scripts

| Script | Purpose |
| ------ | ------- |
| `scripts/server` | Main dev script. Installs Go/Node/protoc if needed, compiles protos, builds UI, starts server on port 41520 with `-tags development` for hot reload. Kills any existing server on the port first. |
| `scripts/desktop` | Builds macOS Wails desktop app. Supports `--build=development` (ad-hoc signing) and `--build=distribution` (code signing + notarization + DMG). |
| `scripts/common` | Shared functions for other scripts: `install_protoc()` and `install_nodejs()`. Supports Linux and macOS. |
| `scripts/docker` | Builds Docker image with tests enabled, runs container, waits for startup, opens browser. |
| `scripts/demo-protos` | Fetches demo proto files from external repos (kaja-tools/website, moul/pb) into `workspace/`. |
| `scripts/desktop-post-build` | Post-build hook for Wails. Bundles protoc, protoc-gen-ts, and node into the macOS app bundle. |

## CI/CD

Three GitHub Actions workflows in `.github/workflows/`:

- **main.yml** — On push to `main`: builds Docker image with tests, pushes to `kajatools/kaja:latest` on Docker Hub.
- **desktop.yml** — On pull requests: builds macOS desktop app with `scripts/desktop --build=development`, uploads DMG artifact.
- **demo.yml** — On pull requests: builds Docker image, starts server, records demo video/screenshots with Playwright, updates PR description with results.

## Testing Conventions

**Go tests** live alongside source files (`*_test.go`):

- `server/pkg/api/api_test.go`, `configuration_test.go`
- `server/pkg/grpc/client_test.go`, `reflection_test.go`

**TypeScript tests** use Vitest and live alongside source files (`*.test.ts`):

- `ui/src/typeMemory.test.ts`, `defaultInput.test.ts`, `tabModel.test.ts`
- `ui/src/formatter.test.ts`, `jsonSchema.test.ts`
- `ui/src/server/connection.test.ts`
