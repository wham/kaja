import type { ImportDeclaration } from "@babel/types";
import { canonicalEndpoint } from "../knownServers";
import { parseScript } from "../scriptSyntax";
import { isLinkedScript } from "../scriptLink";
import { remapEditorCode } from "../sources";
import { WorkspaceApp } from "../server/api";
import githubInbox from "./github/inbox.story" with { type: "text" };
import githubMyPullRequests from "./github/my-pull-requests.story" with { type: "text" };
import githubRepoPulse from "./github/repo-pulse.story" with { type: "text" };
import githubWaitingOnMe from "./github/waiting-on-me.story" with { type: "text" };
import githubWhereIveBeen from "./github/where-ive-been.story" with { type: "text" };
import benchlingAlreadyRegistered from "./benchling/already-registered.story" with { type: "text" };
import benchlingAwaitingReview from "./benchling/awaiting-review.story" with { type: "text" };
import benchlingBox from "./benchling/box.story" with { type: "text" };
import benchlingFreezerSpace from "./benchling/freezer-space.story" with { type: "text" };
import benchlingNewPlasmid from "./benchling/new-plasmid.story" with { type: "text" };
import benchlingNotebookWeek from "./benchling/notebook-week.story" with { type: "text" };
import benchlingSequence from "./benchling/sequence.story" with { type: "text" };
import benchlingSequenceLibrary from "./benchling/sequence-library.story" with { type: "text" };
import benchlingTeamDirectory from "./benchling/team-directory.story" with { type: "text" };
import benchlingWorkflowBoard from "./benchling/workflow-board.story" with { type: "text" };

export interface Story {
  // What a `kaja.run` in another story of the collection reaches it by.
  name: string;
  title: string;
  summary: string;
  // Written against the collection's import name, which instantiating rewrites.
  code: string;
}

export interface StoryCollection {
  id: string;
  // The document the stories are written against.
  document: string;
  // The one server that document describes, for an app read from a copy of it. An API
  // with a host per customer has none.
  server?: string;
  importName: string;
  stories: Story[];
}

export const collections: StoryCollection[] = [
  {
    id: "github",
    server: "https://api.github.com",
    document: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    importName: "github",
    stories: [
      {
        name: "my-pull-requests",
        title: "My pull requests",
        summary: "Your open pull requests everywhere, and who has approved them",
        code: githubMyPullRequests,
      },
      { name: "waiting-on-me", title: "Waiting on me", summary: "Reviews you were asked for, and what is assigned to you", code: githubWaitingOnMe },
      { name: "inbox", title: "Inbox", summary: "Your notifications, unread first, a page at a time", code: githubInbox },
      { name: "where-ive-been", title: "Where I've been", summary: "Repositories you can push to, by last push", code: githubWhereIveBeen },
      { name: "repo-pulse", title: "Repo pulse", summary: "One repository's week: commits, CI and open pull requests", code: githubRepoPulse },
    ],
  },
  {
    id: "benchling",
    document: "https://benchling.com/api/v3/openapi.yaml",
    importName: "benchling",
    stories: [
      { name: "sequence-library", title: "Sequence library", summary: "Every DNA sequence, most recently changed first", code: benchlingSequenceLibrary },
      { name: "sequence", title: "Sequence", summary: "One sequence: its annotations, primers, translations and bases", code: benchlingSequence },
      {
        name: "already-registered",
        title: "Already registered?",
        summary: "Whether Benchling holds these exact bases, on either strand",
        code: benchlingAlreadyRegistered,
      },
      { name: "new-plasmid", title: "New plasmid", summary: "Paste bases, pick a folder, and create it once you approve", code: benchlingNewPlasmid },
      { name: "freezer-space", title: "Freezer space", summary: "The boxes in one location, and how full each is", code: benchlingFreezerSpace },
      { name: "box", title: "Box", summary: "One box drawn as its grid of tubes", code: benchlingBox },
      {
        name: "notebook-week",
        title: "Notebook this week",
        summary: "Entries touched in the last seven days, and who started them",
        code: benchlingNotebookWeek,
      },
      { name: "awaiting-review", title: "Awaiting review", summary: "What is waiting for review, and on whom", code: benchlingAwaitingReview },
      { name: "workflow-board", title: "Workflow board", summary: "Open tasks past their date, and every task by status", code: benchlingWorkflowBoard },
      {
        name: "team-directory",
        title: "Team directory",
        summary: "One team's members, their roles and when they were last seen",
        code: benchlingTeamDirectory,
      },
    ],
  },
];

export function collectionFor(app: WorkspaceApp): StoryCollection | undefined {
  if (app.app.oneofKind !== "openapi") return undefined;
  const document = canonicalEndpoint(app.app.openapi.specUrl);
  const server = canonicalEndpoint(app.app.openapi.baseUrl);
  return (
    (document && collections.find((collection) => canonicalEndpoint(collection.document) === document)) ||
    (server && collections.find((collection) => collection.server && canonicalEndpoint(collection.server) === server)) ||
    undefined
  );
}

export function storyId(collection: StoryCollection, story: Story): string {
  return `${collection.id}/${story.name}`;
}

export function storyById(id: string): { collection: StoryCollection; story: Story } | undefined {
  for (const collection of collections) {
    const story = collection.stories.find((candidate) => storyId(collection, candidate) === id);
    if (story) return { collection, story };
  }
  return undefined;
}

export function instantiateStory(collection: StoryCollection, story: Story, appName: string): string {
  return appName === collection.importName ? story.code : remapEditorCode(story.code, collection.importName, appName);
}

export function linkedStory(collection: StoryCollection, named: string): Story | undefined {
  return collection.stories.find((story) => isLinkedScript(story.name, named));
}

export function storyServices(collection: StoryCollection, story: Story): string[] {
  const file = parseScript(story.code);
  if (!file) return [];
  return file.program.body
    .filter((statement): statement is ImportDeclaration => statement.type === "ImportDeclaration" && statement.source.value === collection.importName)
    .flatMap((statement) =>
      statement.specifiers.flatMap((specifier) =>
        specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" ? [specifier.imported.name] : [],
      ),
    );
}
