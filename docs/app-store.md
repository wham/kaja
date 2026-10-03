# Mac App Store listing

What to put in each App Store Connect field, and which screenshots to upload.
The wording is the website's.

## Name (30)

```
Kaja: gRPC & OpenAPI Client
```

## Subtitle (30)

```
Built for you and your agents
```

## Promotional text (170)

```
Connect gRPC, OpenAPI, or MCP. Explore APIs yourself, or let an agent write and run typed scripts. Every request stays visible and inspectable.
```

## Keywords (100)

```
twirp,mcp,api,rest,protobuf,proto,swagger,http,json,typescript,script,ai,load test,reflection,debug
```

## Description (4000)

```
Kaja is the API client built for you and your agents.

Connect gRPC, OpenAPI, or MCP. Explore APIs yourself, or let an agent write and run typed scripts. Every request stays visible and inspectable.

CONNECT. RUN. INSPECT.
One window: your APIs on the left, the script in the middle, and every call it made underneath.

CONNECT YOUR API
• gRPC through server reflection or your .proto files, with TLS and credentials per app
• OpenAPI 3.0 and 3.1 from a URL, a file, or pasted text
• MCP servers, whose tools, prompts and resources become methods you can call
• Twirp through its address and your .proto files
Browse every service and method in one tree.

RUN IT YOURSELF OR ASK AN AGENT
• Click a method and Kaja drafts the call as a typed TypeScript script
• Autocomplete for every request field, straight from the API's own types
• Chain calls, loop over pages, and ask for input as the script runs
• Draw tables and text on a canvas instead of reading raw JSON
• Approve a call before it is sent
• Run a load test and read latency percentiles, throughput and errors
• Save scripts as plain files in a folder you choose

SEE EXACTLY WHAT HAPPENED
Requests, responses, headers, duration and status stay visible for every run. The log keeps every call in order, and the canvas shows what the script drew.

AGENTS CAN DO THE WORK WITHOUT BECOMING A BLACK BOX
Kaja includes an MCP server for the APIs you connected. Point Claude Code, Codex, Cursor, VS Code or any other MCP-capable agent at it. The agent writes TypeScript against your APIs and runs it through Kaja. Every request it makes appears alongside your own.

SECRETS STAY OUT OF YOUR FILES
Keep a token in the macOS Keychain or the environment. Your workspace file only names it.

YOUR WORKSPACE, YOUR FILES
Everything lives in one kaja.json and a folder of scripts, so a workspace can be committed next to the code it tests. Kaja collects no data.

Kaja is open source. Documentation and a live demo are at kaja.tools.
```

## What's New

```
• A table cell can run another script
• Links between scripts are checked as you type, and follow a script when it is renamed
• Renaming an app updates every script that imports it
• Run repeats the parameters of the last run
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
size. The first three show in search results, so they go first. The App Store
has no caption field, so a caption is drawn into the image.

| # | Caption | What's on screen |
| --- | --- | --- |
| 1 | Connect. Run. Inspect. | The whole window: the tree with the three apps expanded, `whats-on.ts` in the editor, the canvas underneath showing the listings table mid-run. |
| 2 | Let an agent write the script | An agent's draft at the top of Drafts, the script it wrote in the editor, and its run in the Calls log. |
| 3 | Connect your API | The New app dialog listing gRPC, OpenAPI, MCP and Twirp. |
| 4 | Click a method, get a typed script | A drafted `ListMovies` call with the completion list open on a request field. |
| 5 | See exactly what happened | The Calls log with the response JSON and the status, duration and size strip. |
| 6 | Tables, not JSON | Full-screen canvas: the `movies.ts` table paging through 1,283 rows, with search. |
| 7 | Approve before it's sent | `a-night-out.ts` waiting on its approve block, with the `BookSeats` request, Approve and Stop. |
| 8 | Load test with one call | Full-screen Stats for `how-fast.ts`. |
| 9 | Secrets stay out of your files | The Variables table with a Keychain row, an environment row and plain values. |
| 10 | Works with the agent you already use | The MCP server page switched on, with Claude Code's command shown. |
