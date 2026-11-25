# Mac App Store listing

What to put in each App Store Connect field, and which screenshots to upload.
The wording follows the website's.

## Name (30)

```
Kaja: gRPC, OpenAPI & MCP
```

## Subtitle (30)

```
API client for people & agents
```

## Promotional text (170)

```
Connect OpenAPI, MCP or gRPC and sign in from the form. Explore an API yourself, or let an agent write and run typed scripts. Every request stays visible.
```

## Keywords (100)

```
twirp,rest,protobuf,proto,swagger,http,json,typescript,script,ai,load test,reflection,debug,oauth
```

## Description (4000)

```
Kaja is the API client for people and agents.

Connect OpenAPI, MCP, or gRPC. Explore APIs yourself, or let an agent write and run typed scripts. Every request stays visible and inspectable.

CONNECT YOUR API
• OpenAPI from a URL or a file
• MCP servers, whose tools become methods you can call
• gRPC and Twirp, through server reflection or your .proto files
• Sign in with your browser instead of pasting a token

RUN IT YOURSELF OR ASK AN AGENT
• Click a method and Kaja drafts the call as a TypeScript script, with autocomplete for every field
• Chain calls, page through lists, and ask for input as the script runs
• Show results as tables instead of raw JSON
• Run a load test and read latency, throughput and errors
• Point Claude Code, Codex, Cursor or any other MCP-capable agent at Kaja, and it writes and runs scripts against your APIs

SEE EXACTLY WHAT HAPPENED
Every request, response, header, status and duration stays visible, whether you made the call or an agent did.

YOUR FILES, YOUR SECRETS
A workspace is a folder: one kaja.json and your scripts, ready to commit next to your code. Tokens stay in the macOS Keychain, never in the file. Kaja collects no data.

Kaja is open source. Documentation and a live demo are at kaja.tools.
```

## What's New

```
• Workspaces: open any folder and switch between them
• Sign in with your browser instead of pasting a token
• Pick GitHub, OpenAI and other known APIs from a list
• An agent can connect an API for you
• A faster, rebuilt script editor
```

Check against the release notes before submitting.

## Other fields

| Field | Value |
| --- | --- |
| Primary category | Developer Tools |
| Secondary category | Productivity |
| Price | Free |
| Age rating | 4+ |
| Support URL | https://github.com/wham/kaja/issues |
| Marketing URL | https://kaja.tools |
| Privacy policy URL | https://kaja.tools/privacy |
| App privacy | Data Not Collected |
| Copyright | 2026 Tomas Vesely |

## Screenshots

Up to ten, 2880×1800, no alpha channel. `scripts/demo` takes them at this
size, in this order, into `desktop/build/screenshots`. The first three show in
search results, so the upload order is the Order column rather than the order
they are taken in. A shot is the window itself and fills the image, so the
caption is what the picture is for rather than something drawn into it.

| File | Order | Caption | What's on screen |
| --- | --- | --- | --- |
| `06-canvas.png` | 1 | Tables, not JSON | Full-screen canvas: `trending.ts` listing this week's most-starred repositories, each one a link into `repo-pulse.ts`. |
| `05-run.png` | 2 | See exactly what happened | The drafted `Licenses.GetAllCommonlyUsed` call, run, with its response under the editor. |
| `03-apps.png` | 3 | Connect. Run. Inspect. | The GitHub and Eliza trees in the sidebar, and Start listing the workspace's scripts. |
| `02-new-app.png` | 4 | Connect your API | The New app form asking for the type: OpenAPI, MCP, gRPC and Twirp. |
| `04-draft.png` | 5 | Click a method, get a typed script | The draft a click on `Licenses.GetAllCommonlyUsed` wrote. |
| `07-stats.png` | 6 | Load test with one call | Full-screen Stats for `how-fast.ts` against Eliza. |
| `08-variables.png` | 7 | Secrets stay out of your files | The Variables table with a Keychain row beside plain values. |
| `09-agent.png` | 8 | Works with the agent you already use | The MCP server page with the agents it can be added to. |
| `01-start.png` | 9 | Start with an app or an agent | Start in an empty workspace: the map, and the two ways in. |
