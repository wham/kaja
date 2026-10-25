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
  // The server the API's document declares, which is what the collection belongs to.
  server: string;
  // The document Kaja knows describes that server, for an app that names no base URL.
  document: string;
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
];

export function collectionFor(app: WorkspaceApp): StoryCollection | undefined {
  if (app.app.oneofKind !== "openapi") return undefined;
  const { baseUrl, specUrl } = app.app.openapi;
  if (baseUrl.trim()) {
    const server = canonicalEndpoint(baseUrl);
    return server ? collections.find((collection) => canonicalEndpoint(collection.server) === server) : undefined;
  }
  const document = canonicalEndpoint(specUrl);
  return document ? collections.find((collection) => canonicalEndpoint(collection.document) === document) : undefined;
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
