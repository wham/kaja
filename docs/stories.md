# Stories

A story is a script Kaja ships for an API it knows, and a collection is the handful of them for one API. They exist to answer the first question anyone has on opening an API with nine hundred methods, above all on a phone: *what would I even do with this?* A story is the answer as a thing you can run, not a thing you read.

The five GitHub stories beside this file (`docs/stories/github/`) are the first collection and the reference for what a story is. Each is an ordinary Kaja script: it imports the app, makes calls, draws tables. Nothing in a story is a format of its own.

## Decisions

- **A story is a script and nothing else.** Everything you run is a script, and a method in the tree is already a template that fills a draft. A story is a longer template. It carries no comments, for the demo workspace's reason: it is the picture of what a script looks like, and on a phone a paragraph over the code is the first thing the pane shows.
- **A collection belongs to an API, and is matched by the server its document declares.** The same rule `known_apis.go` uses to supply GitHub's auth schemes, and the same rule `knownServers.ts` matches an MCP endpoint by: the canonical server URL, never the app's name or the document's title. An app of the OpenAPI type whose document declares `https://api.github.com` has the GitHub collection; the GitHub MCP server at `api.githubcopilot.com` is a different surface and has none.
- **Stories are not in the Scripts tab, and never in the workspace folder.** They live in the binary. What a story *produces* when tapped is a draft, and that draft is yours like any other: it has a row in Drafts, a console, a run history. The collection itself is only ever on the app's page.
- **A story is written against the API's canonical import name and rewritten to the app's.** The GitHub stories import from `"github"`. The person's app may be called anything, so instantiating a story splices the module specifier to the app's actual name, the way `followAppRenames` already splices one when an app is renamed: the AST names the import, the text is edited rather than reprinted.
- **Tapping a story runs it.** The phone is for running, and on the desktop the console shows the result beside the code. There is no separate "open" gesture. A story that needs a value asks for it itself with `kaja.ask*`, falling back from `kaja.input`, so no parameter sheet opens in front of a tap; the tap behaves as a `kaja.run` cell click does.
- **One draft per story.** Tapping a story the second time reopens the draft it made rather than piling another one, the way an agent has one draft. The draft remembers which story it came from (`storyId` on `Draft`, beside `agentName`). If the person edited it, the edited draft is what reopens: it is still their copy of the story. The Run menu on such a draft gains `Reset story`, which puts the shipped text back.
- **Stories in one collection may link to each other with `kaja.run`.** Where I've Been links each row to Repo Pulse. `isLinkedScript` resolves a name against the workspace's files first and then, when the running script is a story's draft, against the names of its own collection; a story found that way is instantiated and run with the input, like a file would be. A deeplink outside Kaja cannot reach a story in this version, a story having no file.
- **Stories are read-only in the first version.** All five GitHub stories make reads. A collection may later carry a story that writes, and its card then wears the `write` mark the catalog already has; `kaja.approve` is how such a story asks.

## Where a collection appears

**The app page.** A new view (`ViewIdentity` kind `app`, keyed by app name) that is the API's home. It holds, top to bottom: the app's name and type, the document's title and the first paragraph of its description, the story carousel, and on the phone the method tree under a `Browse methods` heading. An app with no collection still has the page, without the carousel. The page is a destination in the finder, so `⌘P GitHub ⏎` lands on it.

- On the **desktop**, clicking an app's name in the Apps tab opens its page and the chevron folds it, the rule a folder row already follows in Files: the gesture is on the name, not the row.
- On the **phone**, tapping an app in the finder opens its page instead of expanding the tree in place. The tree it expanded is what the page's lower half is.
- **Right after adding an app**, the New app form's Save opens the app's page. The carousel draws at once; the cards are dimmed while the app compiles and the compile state is said once above them, since running a story needs the surface. A compile that fails leaves the cards dimmed with the marker that opens the log.
- **Start** is left as it is in this version. A row of collections on Start is the natural next step once there is more than one.

**The carousel.** A horizontal strip of cards, one card about 80% of the width on a phone, snapping one card per swipe (CSS scroll snap, no library). On the desktop the same strip with the cards at a fixed width and the trailing card peeking, scrolling with the wheel or trackpad. No dots, no arrows: the peeking edge of the next card is the affordance. Order is the collection's own.

**A card** says, in this order: the story's title (`My pull requests`), one line of what it does (`Open PRs you wrote, with who has approved`), and the services it calls as chips (`Search`, `Pulls`), read off the script's imports and member accesses rather than declared twice. A story that writes carries the `write` mark here. Tap anywhere on the card runs it. A long-press on the phone, or a right-click on the desktop, offers `Open code` for a reader who wants the script first.

## Files and build

```
ui/src/stories/
  index.ts              the collections, keyed by canonical server URL
  github/
    collection.ts       title, subtitle and order per story
    my-pull-requests.ts
    waiting-on-me.ts
    inbox.ts
    repo-pulse.ts
    where-ive-been.ts
```

- A story's text is imported as text, `import text from "./inbox.ts" with { type: "text" }`, which the esbuild the server pins supports, so the script lands in the bundle as a string and nothing evaluates it. It is checked in formatted, which is what makes the usual "generated code goes through prettier before it reaches the model" rule hold for a story too.
- `collection.ts` carries the title, the one-line subtitle and the import name the stories were written against (`"github"`), per story. The services on the card are derived from the text at render, not written here.
- **The manifest carries the document's declared servers**, canonical, which is the one new thing on the Go side: `Compile` already has the document, and the UI matches a collection against that list with the same canonicalisation `canonicalEndpoint` does for an MCP endpoint. An app with `base_url` set matches on that too, since the person may have picked a server the document also lists.
- **Tests.** A unit test over the collection asserts that every story parses with `@babel/parser`, imports only `kaja` and the collection's import name, reads `kaja.input` keys the collection names, and that every `kaja.run` names a story in the same collection. Whether the calls match the live document cannot be asserted offline, since the GitHub description is tens of megabytes; the first task is to add the GitHub app and run all five, and it should be rerun whenever the pinned description moves.

## The GitHub collection

| Story | Title on the card | What it shows | Calls |
|---|---|---|---|
| `my-pull-requests` | My pull requests | Your open PRs across every repo, newest activity first. The reviews column is a function cell, so each PR's approvals are fetched as the row scrolls into view. | `Search.IssuesAndPullRequests`, `Pulls.ListReviews` |
| `waiting-on-me` | Waiting on me | PRs asking for your review, then issues and PRs assigned to you. Two calls in a `Promise.all`, two tables. | `Search.IssuesAndPullRequests`, `Issues.ListForAuthenticatedUser` |
| `inbox` | Inbox | Your notifications, unread marked, paged live as you press Next. The search box filters loaded rows, since the source takes no search parameter. | `Activity.ListNotificationsForAuthenticatedUser` |
| `repo-pulse` | Repo pulse | One repository's week: who committed, how CI is doing, what is open. Takes `repo` as `kaja.input` and asks for it when it has none. | `Repos.Get`, `Repos.ListCommits`, `Actions.ListWorkflowRunsForRepo`, `Pulls.List` |
| `where-ive-been` | Where I've been | Repositories you can push to, by last push, each row linking into Repo pulse. | `Repos.ListForAuthenticatedUser` |

The method names follow the OpenAPI generator's rules: the first tag is the service, the operationId in PascalCase is the method with the service's name trimmed off its front, and parameters are the proto field in camelCase (`per_page` becomes `perPage`, `pull_number` becomes `pullNumber`). Array responses arrive under `items`, the HTTP envelope. All five scripts parse; none has been compiled against the live document yet, so the names that most want checking are the nullable ones read with `?.` and the `since` query parameter on `ListCommits`.

## Out of scope

- Stories for a second API. The shape should be proven on one collection before a second is written.
- An agent-facing surface for stories. The MCP catalog's `list_services` and `describe_method` stay as they are.
- Stories reachable by deeplink, and stories that write to the workspace folder.
- Generating stories from a document. They are written by hand, or by an agent and reviewed, and committed.

## What goes in AGENTS.md

Three sentences, under Apps: a story is a shipped script keyed to the server an API's document declares and instantiated as a draft with its import specifier rewritten to the app's name; the collection appears on the app's page and nowhere in Scripts; a `kaja.run` from a story's draft resolves against its collection after the workspace's files.
