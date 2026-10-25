import { kaja } from "kaja";
import { Repos } from "github";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const { items: repos } = await Repos.ListForAuthenticatedUser({ sort: "pushed", direction: "desc", perPage: 30 });

kaja.text("The repositories you can push to, by when anyone last did.");

const table = kaja.table(["repo", "pushed", "open issues", "stars", ""]);
for (const repository of repos) {
  table.row(
    repository.fullName,
    repository.pushedAt ? ago(repository.pushedAt) : "",
    repository.openIssuesCount,
    repository.stargazersCount,
    kaja.run("repo-pulse", { repo: repository.fullName }, { label: "Pulse" }),
  );
}
