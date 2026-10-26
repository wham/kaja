import { kaja } from "kaja";
import { Pulls, Repos } from "github";

const full = kaja.input.repo || (await kaja.askStr("Which repository? owner/name"));
const [owner, repo] = full.trim().split("/");
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const [about, commits, pulls] = await Promise.all([
  Repos.Get({ owner, repo }),
  Repos.ListCommits({ owner, repo, since, perPage: 100 }),
  Pulls.List({ owner, repo, state: "open", sort: "updated", direction: "desc", perPage: 20 }),
]);

kaja.text(
  `${about.fullName}: ${count(about.stargazersCount, "star")}, ${count(about.forksCount, "fork")}, ${count(commits.items.length, "commit")} in the last week.`,
);

const byAuthor = new Map<string, number>();
for (const entry of commits.items) {
  const who = entry.author?.login ?? entry.commit?.author?.name ?? "unknown";
  byAuthor.set(who, (byAuthor.get(who) ?? 0) + 1);
}
if (byAuthor.size > 0) {
  kaja.table(
    [...byAuthor].sort((a, b) => b[1] - a[1]),
    ([author, commits]) => ({ author: kaja.run("who-is", { user: author }, { label: author }), "commits this week": commits }),
    { title: "Who committed" },
  );
}

if (pulls.items.length > 0) {
  kaja.table(
    pulls.items,
    (pr) => ({
      "pull request": `#${pr.number} ${pr.draft ? "Draft: " : ""}${pr.title}`,
      author: pr.user?.login ?? "",
      updated: pr.updatedAt,
    }),
    { title: "Open pull requests" },
  );
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}
