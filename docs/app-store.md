# Mac App Store listing

A draft of every field App Store Connect asks for, and of the screenshots. The
wording comes from kaja.tools. Where this page and the website disagree, one of
them should change so that they match again.

## One voice, three places

Right now the product describes itself three different ways:

| Where | What it says today |
| --- | --- |
| App Store name | Kaja for gRPC and Twirp |
| README | A canvas for your APIs · "An API client like Postman or Bruno, except your agent writes the payloads." |
| kaja.tools | The API client built for you and your agents. |

The App Store name is the oldest of the three and undersells the product. It
leaves out OpenAPI and MCP, and it never mentions agents. The website's line is
the most current, so everything below is built from it. The README's headline
should move to it as well. "Canvas" is still the right word for what a run
draws, but people search for "API client", not "canvas".

**Shared vocabulary.** Use the same words everywhere, in this order of
preference:

- **API client**: the category. Not "API tool", "API explorer" or "REST client".
- **Connect**: what you do to an API. Each connected API is an **app** inside
  the product, but marketing copy says **API**.
- **gRPC, OpenAPI, MCP and Twirp**: always all four, always in this order
  (the website's order), always "OpenAPI" rather than "REST" or "Swagger".
- **Typed scripts / TypeScript**: what the agent, or you, writes.
- **Agent**: never "AI assistant" or "copilot".
- **Every request stays visible and inspectable**: the promise, stated in these
  words.
- **Connect. Run. Inspect.**: the three-beat structure the website already uses
  for its sections. The description and the screenshots follow it too.

## Fields

### Name (30 characters max)

```
Kaja: gRPC & OpenAPI Client
```

27 characters. The App Store's search weights the name most heavily, and "grpc"
and "openapi" are the two terms a developer searching for this category types.
"Client" is the category. MCP and Twirp go in the keywords because there's no
room for them here.

Alternatives considered:

- `Kaja – API Client for Agents` (28). Closest to the website's headline, but it
  gives up "grpc", which is the term the current listing already ranks for, and
  the one reviewer so far found the app through.
- `Kaja` alone. Clean, but it wastes the most heavily weighted field on a word
  nobody searches for yet.

### Subtitle (30 characters max)

```
Built for you and your agents
```

29 characters. This is the second half of the website's headline, word for word.
The name says what it is and the subtitle says who it's for, so together they
read as the site's hero: *API client, built for you and your agents*.

### Promotional text (170 characters max, can be changed without a review)

```
Connect gRPC, OpenAPI, MCP or Twirp. Explore an API yourself, or let an agent write and run typed scripts. Every request stays visible and inspectable.
```

151 characters. This is the website's subheadline with Twirp added. It's the one
field that can change without a new build, so use it for release news when
there is some ("New in 0.16: …") and fall back to this line otherwise.

### Keywords (100 characters max, comma-separated, no spaces)

```
twirp,mcp,api,rest,protobuf,proto,swagger,http,json,typescript,script,ai,load test,reflection,debug
```

99 characters. Words already in the name and subtitle (kaja, grpc, openapi,
client, agents) are indexed from there, so they aren't repeated. Competitor
names (Postman, Bruno, Insomnia) and agent product names (Claude, Cursor) are
left out on purpose, because Apple rejects keywords that use another company's
trademark. "rest" and "swagger" are here even though the copy says OpenAPI,
because they're what people type.

### Description (4000 characters max)

```
Kaja is the API client built for you and your agents.

Connect gRPC, OpenAPI, MCP or Twirp. Explore an API yourself, or let an agent write and run typed scripts. Every request stays visible and inspectable.

CONNECT. RUN. INSPECT.
One window: your APIs on the left, the script in the middle, and every call it made underneath.

CONNECT YOUR API
• gRPC through server reflection or your .proto files, with TLS and credentials per app
• OpenAPI 3.0 and 3.1 from a URL, a file, or pasted text, with the spec's own authentication
• MCP servers, whose tools, prompts and resources become methods you can call
• Twirp through its address and your .proto files
Browse every service and method in one tree.

RUN IT YOURSELF OR ASK AN AGENT
• Click a method and Kaja drafts the call as a typed TypeScript script
• Autocomplete for every request field, straight from the API's own types
• Chain calls, loop over pages, and ask for input as the script runs
• Draw tables and text on a canvas instead of reading raw JSON
• Approve a call before it is sent
• Run a load test with one call and read latency percentiles, throughput and errors
• Save scripts as plain files in a folder you choose, and link to them with kaja:// deeplinks

SEE EXACTLY WHAT HAPPENED
Requests, responses, headers, duration and status stay visible for every run. Nothing is summarised away: the log keeps every call in order, and the canvas shows what the script drew.

AGENTS CAN DO THE WORK WITHOUT BECOMING A BLACK BOX
Kaja includes an MCP server for the APIs you connected. Point Claude Code, Codex, Cursor, VS Code or any other MCP-capable agent at it, and the agent can look up methods, write TypeScript against your APIs, and run it through Kaja. Every request it makes appears alongside your own, in a draft you can read, rerun and keep.

SECRETS STAY OUT OF YOUR FILES
Variables are named values shared by scripts and app configuration. Keep a token in the macOS Keychain or the environment, and your workspace file only names it.

YOUR WORKSPACE, YOUR FILES
Everything lives in one kaja.json and a folder of scripts, so a workspace can be committed next to the code it tests. Kaja collects no data.

Kaja is open source. Documentation and a live demo are at kaja.tools.
```

Roughly 2,300 characters. That leaves room to grow, but a longer description
adds nothing: only the first three lines show before "more", and those three
lines are the name, the subheadline and the promise.

A few notes on the draft:

- Agents are named in the description, since that's descriptive use rather
  than a keyword, and the MCP page in the app lists them too. If review pushes
  back, "any MCP-capable agent" on its own still reads fine.
- The chat and folder app types are left out while they're behind a feature
  preview.
- The website's docs page lists three app types (it's missing MCP). It should
  list all four so it matches this description.

### What's New (0.16.0)

```
• A table cell can run another script, so one script can link to the next
• Links between scripts are checked as you type, and follow a script when it is renamed
• Renaming an app updates every script that imports it
• Run repeats the parameters of the last run
```

Check this against the actual 0.16 changelog before submitting. The release
notes that `ship` generates are the source of truth, and this is a reader's
summary of them.

### The rest

| Field | Value |
| --- | --- |
| Primary category | Developer Tools |
| Secondary category | Productivity |
| Price | Free |
| Age rating | 4+ |
| Support URL | https://github.com/wham/kaja/issues |
| Marketing URL | https://kaja.tools |
| Privacy policy URL | https://kaja.tools/privacy (a page is needed if there isn't one yet) |
| App privacy | Data Not Collected |
| Copyright | 2026 Tomas Vesely (from `desktop/build/config.yml`) |

## Screenshots

The Mac App Store takes up to ten screenshots at 16:10. `scripts/demo` shoots
at 1440×900 points, which comes out as 2880×1800 on a Retina display. The
first three do almost all the work: they're the ones shown in search results
and above the fold. So the order below puts the product's promise first, not
the order you'd meet things in the app.

The Mac App Store has no caption field, so any headline has to be drawn into
the image itself. Recommended: frame each shot with a caption band above it,
in the website's type and colours, so a screenshot looks like a section of
kaja.tools. Each caption below is a heading the website already uses, or one
written in the same voice. If raw window shots are kept, the captions still
work as the website's alt text and section order.

The current set (`desktop/build/screenshots`) has three problems worth fixing:

1. **It opens on an empty workspace** (`01-start`). This is the least
   informative frame there is, and it sits in the most valuable slot.
2. **The MCP server is shown switched off** (`09-agent`). The one screen
   about agents says "Off · turn it on to let an agent connect".
3. **No agent is ever seen doing anything.** The headline promise ("for you
   and your agents") has no picture.

### Proposed set

| # | Caption | What's on screen | Source |
| --- | --- | --- | --- |
| 1 | **Connect. Run. Inspect.** · One window for your APIs, your scripts and every call they made. | The three-pane window: the tree with all three apps expanded on the left, `whats-on.ts` in the editor, and underneath it the canvas mid-run showing the listings table with some seat cells still loading. | New beat: open `whats-on.ts`, run it, answer the city question, and shoot with the console at its normal size, not full-screen. |
| 2 | **Let an agent write the script** · Every request it makes appears alongside your own. | An agent's draft pinned at the top of Drafts wearing the agent's name (for example "claude-code"), the script it wrote in the editor, and its run in the Calls log. | New beat: drive a `run_script` over the MCP endpoint with curl before the shot, so an agent draft exists without scripting a real agent. |
| 3 | **Connect your API** · gRPC, OpenAPI, MCP and Twirp. | The New app dialog listing the four types. | `02-new-app`, as is. |
| 4 | **Click a method, get a typed script** · Every field autocompletes from the API's own types. | A drafted `ListMovies` call with Monaco's completion list open on a request field. | `04-draft`, plus a keystroke to open completions inside the braces. |
| 5 | **See exactly what happened** · Requests, responses, headers, duration and status for every call. | The Calls log with the response JSON, and the OK · 22 ms · 31.5 KB strip. | `05-run`, as is. An alternative is the Headers tab, which shows both halves of the exchange. |
| 6 | **Tables, not JSON** · Scripts draw what they found, and page through thousands of rows. | Full-screen canvas: the `movies.ts` table at 1–100 of 1,283 with search. | `06-canvas`, as is. |
| 7 | **Approve before it's sent** · A write waits for you, with the request in full. | `a-night-out.ts` parked on its approve block: the answered questions collapsed above it, the concierge's pick, and the `BookSeats` request with Approve and Stop. | New beat: run `a-night-out.ts`, answer three questions, and shoot while it waits. |
| 8 | **Load test with one call** · Latency percentiles, throughput and errors as the test runs. | Full-screen Stats for `how-fast.ts`. | `07-stats`, as is. |
| 9 | **Secrets stay out of your files** · Keep a token in the Keychain. Your workspace only names it. | The Variables table with a Keychain row, an environment row and plain values. | `08-variables`, as is. |
| 10 | **Works with the agent you already use** · Claude Code, Codex, Cursor, VS Code and more. | The MCP server page switched **on**, with Claude Code's command shown. | `09-agent`, with the switch turned on first. |

What was dropped: `01-start` (the empty workspace) and `03-apps` (the tree
alone, which shots 1, 2 and 4 already show).

### Changes this implies for `scripts/demo`

These aren't made yet, only listed:

- Start staging with the apps already present, and drop the empty-workspace
  beat.
- Add the three new beats: whats-on mid-run, the agent draft, and the approve
  block.
- Turn the MCP switch on before the last shot, by writing
  `"mcp": { "enabled": true }` into the staged kaja.json.
- Shoot in the order above so the file names sort into upload order.

### Website

The website crops its poster images from this same set, so reordering the
screenshots is also how the website's sections line up with them. The site
already uses "Connect your API", "Run it yourself or ask an agent" and "See
exactly what happened" as section headings, and those map onto shots 3, 4 and
5 here.
