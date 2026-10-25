import { kaja } from "kaja";
import { Actions, Pulls, Repos } from "github";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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
  const week = kaja.table(["author", "commits this week"]);
  for (const [who, n] of [...byAuthor].sort((a, b) => b[1] - a[1])) week.row(who, n);
}

if (runs.workflowRuns.length > 0) {
  const ci = kaja.table(["workflow", "result", "branch", "when"]);
  for (const run of runs.workflowRuns) {
    ci.row(run.name ?? "", run.conclusion ?? run.status ?? "", run.headBranch ?? "", ago(run.updatedAt));
  }
}

if (pulls.items.length > 0) {
  const open = kaja.table(["pull request", "author", "updated"]);
  for (const pr of pulls.items) open.row(`#${pr.number} ${pr.draft ? "Draft: " : ""}${pr.title}`, pr.user?.login ?? "", ago(pr.updatedAt));
}
