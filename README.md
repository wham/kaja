<p align="center">
  <a href="https://kaja.tools"><img src="docs/logo.svg" alt="Kaja" width="240" /></a>
</p>

<p align="center">
  <sub><b>macOS · Docker</b></sub>
</p>

<h3 align="center">API Stories</h3>

<p align="center">
  The API client for people and agents.
  <br/>
  Connect gRPC, OpenAPI, or MCP. Explore APIs yourself, or let an agent write and run typed scripts.
  <br/>
  Every request stays visible and inspectable.
</p>

<p align="center">
  <a href="https://apps.apple.com/us/app/kaja-for-grpc-and-twirp/id6761604205?mt=12">
    <img src="https://toolbox.marketingtools.apple.com/api/badges/download-on-the-mac-app-store/black/en-us?size=250x83" alt="Download on the Mac App Store" height="54" />
  </a>
  &nbsp;
  <a href="https://hub.docker.com/r/kajatools/kaja">
    <img src="https://img.shields.io/badge/Pull_from-Docker_Hub-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Pull from Docker Hub" height="40" />
  </a>
</p>

<p align="center">
  <a href="https://kaja.tools/docs"><strong>Documentation</strong></a> ·
  <a href="https://demo.kaja.tools"><strong>Live Demo</strong></a> ·
  <a href="https://kaja.tools"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://github.com/wham/kaja/releases/latest"><img src="https://img.shields.io/github/v/release/wham/kaja" alt="Latest Release" /></a>
  <a href="https://hub.docker.com/r/kajatools/kaja"><img src="https://img.shields.io/docker/pulls/kajatools/kaja" alt="Docker Pulls" /></a>
  <a href="https://github.com/wham/kaja/blob/main/LICENSE"><img src="https://img.shields.io/github/license/wham/kaja" alt="License" /></a>
</p>

<p align="center">
  <img src="docs/how-it-works.svg" alt="An agent writes and runs a script over MCP; every call it makes lands on Kaja's canvas, and Kaja speaks OpenAPI, MCP and gRPC to your apps" width="840" />
</p>

<p align="center">
  <a href="https://demo.kaja.tools">
    <img src="docs/screenshot-1.png" alt="Kaja with a script open, the calls it made and the response below it" width="820" />
  </a>
</p>

## Documentation

Installing Kaja, connecting apps, keeping credentials in variables, writing scripts
and pointing an agent at it are all documented on the website.

<h3 align="center">
  <a href="https://kaja.tools/docs">Read the docs at kaja.tools/docs →</a>
</h3>

|  |  |
| --- | --- |
| **[Installation](https://kaja.tools/docs#installation)** | The Mac App Store build, or one `docker run` with your protos and `kaja.json` mounted |
| **[Apps](https://kaja.tools/docs#apps)** | Connect gRPC, OpenAPI, Twirp and MCP apps, and what each type's block takes |
| **[Variables](https://kaja.tools/docs#variables)** | Named values your scripts and your app configuration both read, with secrets kept out of the file |
| **[Scripts](https://kaja.tools/docs#scripts)** | TypeScript with a typed import for every app you connected, drawing on the canvas |
| **[Agents](https://kaja.tools/docs#agents)** | Point your agent at Kaja's MCP server, and watch every run it makes |

## Development

Needs [Go](https://go.dev/doc/install) and [Bun](https://bun.sh/); the scripts offer to install them via [Homebrew](https://brew.sh).

- Server: `scripts/server` (add `--editable` to edit the workspace from the UI)
- Desktop: `scripts/desktop`
- iOS: `scripts/ios` for the simulator, `scripts/ios device` for an iPhone (needs full Xcode)
- Docker: `scripts/docker`
- Test: `(cd ui && bun test)` and `(cd server && go test ./... -tags development)`

### Releases

Every push to `main` uploads a macOS and iOS build to TestFlight. To ship, run the **release** workflow from GitHub Actions:

1. `open` with `patch`, `minor` or `major` opens a version bump PR. Merge it.
2. `ship` tags the release and publishes it on GitHub. Run it when a TestFlight build goes to the App Store.
