import { kaja } from "kaja";
import { Actions, Pulls, Repos } from "github";

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const full = kaja.input.repo || (await kaja.askStr("Which repository? owner/name"));
const [owner, repo] = full.trim().split("/");
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const [about, commits, runs, pulls] = await Promise.all([
  Repos.Get({ owner, repo }),
  Repos.ListCommits({ owner, repo, since, perPage: 100 }),
  Actions.ListWorkflowRunsForRepo({ owner, repo, perPage: 10 }),
  Pulls.List({ owner, repo, state: "open", perPage: 100 }),
]);

kaja.text(
  `${about.fullName}: ${count(about.stargazersCount, "star")}, ${count(pulls.items.length, "open pull request")}, ${count(commits.items.length, "commit")} in the last week.`,
);

const byAuthor = new Map<string, number>();
for (const entry of commits.items) {
  const who = entry.author?.login ?? entry.commit?.author?.name ?? "unknown";
  byAuthor.set(who, (byAuthor.get(who) ?? 0) + 1);
}
if (byAuthor.size > 0) {
  kaja.table(
    [...byAuthor].sort((a, b) => b[1] - a[1]),
    ([author, commits]) => ({ author, "commits this week": commits }),
  );
}

if (runs.workflowRuns.length > 0) {
  kaja.table(runs.workflowRuns, (run) => ({
    workflow: run.name ?? "",
    result: run.conclusion ?? run.status ?? "",
    branch: run.headBranch ?? "",
    when: run.updatedAt,
  }));
}

if (pulls.items.length > 0) {
  kaja.table(pulls.items, (pr) => ({
    "pull request": `#${pr.number} ${pr.draft ? "Draft: " : ""}${pr.title}`,
    author: pr.user?.login ?? "",
    updated: pr.updatedAt,
  }));
}
