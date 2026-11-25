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

CONNECT. RUN. INSPECT.
One window: your APIs on the left, the script in the middle, and every call it made underneath.

CONNECT YOUR API
• OpenAPI 3.0 and 3.1 from a URL, a file, or pasted text
• MCP servers, whose tools, prompts and resources become methods you can call
• gRPC through server reflection or your .proto files, with TLS and credentials per app
• Twirp through its address and your .proto files
• Pick GitHub, OpenAI, Atlassian or Sentry from a list instead of hunting for the address
Browse every service and method in one tree.

SIGN IN INSTEAD OF PASTING A TOKEN
• Kaja runs the OAuth sign-in an MCP server asks for and renews the token on its own
• Sign in to GitHub's REST API straight from the form
• Give an OpenAPI app a client ID and secret, and Kaja exchanges them for the token
• One sign-in covers every app that calls the same server

RUN IT YOURSELF OR ASK AN AGENT
• Click a method and Kaja drafts the call as a typed TypeScript script
• Autocomplete for every request field, straight from the API's own types
• Chain calls and page through a whole list with one line
• Ask for input as the script runs: text, a number, one choice or several
• Draw tables and text on a canvas instead of reading raw JSON
• Link a table cell to another script, so one result opens the next
• Approve a call before it is sent
• Run a load test and read latency percentiles, throughput and errors
• Give a script an address and run it from Raycast, Alfred, Shortcuts or a shell

SEE EXACTLY WHAT HAPPENED
Requests, responses, headers, duration and status stay visible for every run. The log keeps every call in order, and the canvas shows what the script drew. A JSON document an API tucked inside a string opens in place.

AGENTS CAN DO THE WORK WITHOUT BECOMING A BLACK BOX
Kaja includes an MCP server for the APIs you connected. Point Claude Code, Codex, Cursor, VS Code, GitHub Copilot or any other MCP-capable agent at it, with one command or one click. The agent writes TypeScript against your APIs and runs it through Kaja. It can connect a new API too, and Kaja opens its own form for whatever only you can answer, such as a credential. Every script an agent ran is listed under its name, and every request it made appears alongside your own.

SECRETS STAY OUT OF YOUR FILES
Keep a token in the macOS Keychain or the environment. Your workspace file only names it, and Kaja tells you when an app needs a value this Mac doesn't have yet. Stored values and sign-ins sync through iCloud Keychain.

A WORKSPACE IS A FOLDER
Open any folder as a workspace and switch between them. Everything lives in one kaja.json and the scripts beside it, so a workspace can be committed next to the code it tests and opens the same on every clone. Kaja collects no data.

Kaja is open source. Documentation and a live demo are at kaja.tools.
```

## What's New

```
• Workspaces: open any folder, switch between them, and keep one beside your code
• Sign in to GitHub, Atlassian, Sentry and other servers from the app form, with no token to paste
• Pick a known API or MCP server from a list when adding an app
• An agent can connect an API for you, and Kaja opens its form for what only you can answer
• A rebuilt editor that offers a missing import where the error is
• Tables read their columns from the rows, and kaja.pages walks a paged list in one line
• A script's question can take several answers, or one of your own
• Apps and Scripts are two tabs, and Start lists the workspace's scripts
• Scripts without a file are listed as Recent, signed by who ran them
• Stored values sync through iCloud Keychain, and a missing one is flagged where it bites
• The window remembers its size and position
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
