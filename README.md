<p align="center">
  <a href="https://kaja.tools"><img src="docs/logo.svg" alt="Kaja" /></a>
</p>

<h3 align="center">Explore and call your APIs with code</h3>

<p align="center">
  A code-based UI for <a href="https://grpc.io">gRPC</a> and <a href="https://github.com/twitchtv/twirp">Twirp</a> APIs with full IntelliSense.
  <br/>
  Write TypeScript to construct requests, call services, and inspect responses — no forms, no clicking through fields.
</p>

<p align="center">
  <a href="https://kaja.tools/demo/"><strong>Live Demo</strong></a> ·
  <a href="https://kaja.tools"><strong>Website</strong></a> ·
  <a href="https://hub.docker.com/r/kajatools/kaja"><strong>Docker Hub</strong></a>
</p>

<p align="center">
  <a href="https://github.com/wham/kaja/releases/latest"><img src="https://img.shields.io/github/v/release/wham/kaja" alt="Latest Release" /></a>
  <a href="https://hub.docker.com/r/kajatools/kaja"><img src="https://img.shields.io/docker/pulls/kajatools/kaja" alt="Docker Pulls" /></a>
  <a href="https://github.com/wham/kaja/blob/main/LICENSE"><img src="https://img.shields.io/github/license/wham/kaja" alt="License" /></a>
</p>

<p align="center">
  <a href="https://kaja.tools/demo/">
    <img src="docs/screenshot.png" alt="Kaja — calling a gRPC service with TypeScript" width="720" />
  </a>
</p>

## Features

- **Code-based** — Write TypeScript to call your APIs. Full IntelliSense with autocomplete for services, methods, and message fields.
- **gRPC & Twirp** — Native support for both protocols. Reads your `.proto` files or uses [gRPC server reflection](https://grpc.io/docs/guides/reflection/).
- **macOS & Docker** — Available as a [macOS desktop app](https://github.com/wham/kaja/releases/latest/download/Kaja.dmg) or a [Docker container](https://hub.docker.com/r/kajatools/kaja) for any environment.

## Quick Start

### Docker

```
docker run --pull always --name kaja -d -p 41520:41520 \
    -v /my_app/proto:/workspace/proto \
    -v /my_app/kaja.json:/workspace/kaja.json \
    --add-host=host.docker.internal:host-gateway kajatools/kaja:latest
```

Then open [http://localhost:41520](http://localhost:41520).

### macOS

Download the latest [Kaja.dmg](https://github.com/wham/kaja/releases/latest/download/Kaja.dmg) from GitHub Releases.

## Configuration

On **macOS**, projects are configured through the UI. The configuration is stored at `~/.kaja/kaja.json`.

With **Docker**, create a `kaja.json` file and mount it into the container:

```json
{
  "projects": [
    {
      "name": "my_app",
      "protocol": "RPC_PROTOCOL_TWIRP",
      "url": "http://host.docker.internal:41522"
    }
  ]
}
```

### Project options

| Option | Description |
|---|---|
| `name` | Display name. |
| `protocol` | `RPC_PROTOCOL_TWIRP` or `RPC_PROTOCOL_GRPC`. |
| `url` | URL where the service is running. |
| `protoDir` | Path to `.proto` files. Required unless `useReflection` is enabled. |
| `useReflection` | Use [gRPC server reflection](https://grpc.io/docs/guides/reflection/) instead of local proto files. Only works with gRPC. |
| `headers` | Headers sent with each request (e.g. `{"Authorization": "Bearer xxx"}`). For gRPC, sent as metadata. |

### Docker arguments

| Argument | Description |
|---|---|
| `--pull always` | Always pull the latest image. Kaja is updated frequently. |
| `--name kaja` | Name the container for easy management. |
| `-d` | Run in [detached mode](https://docs.docker.com/engine/reference/run/#detached--d). |
| `-p 41520:41520` | Map the container port. Kaja listens on 41520 by default. |
| `-v .../proto:/workspace/proto` | Mount your [proto_path](https://protobuf.dev/reference/cpp/api-docs/google.protobuf.compiler.command_line_interface/) into the container. |
| `-v .../kaja.json:/workspace/kaja.json` | Mount your [configuration file](#configuration). |
| `--add-host=host.docker.internal:host-gateway` | Access host services from the container. |

## Development

The development scripts require [Go](https://go.dev/doc/install) and [Node.js](https://nodejs.org/) installed. If not installed, they will offer to install them for you via [Homebrew](https://brew.sh).

- Run in local server: `scripts/server`
- Run in Docker: `scripts/docker`
- Run the desktop app: `scripts/desktop`
- Test UI: `(cd ui && npm test)`
- TSC UI: `(cd ui && npm run tsc)`
- Test server: `(cd server && go test ./... -v)`
- Update demo protos: `scripts/demo-protos` (The demo services are deployed via [kaja/tools/website](github.com/kaja-tools/website))
