import { kaja } from "kaja";
import { Repos } from "github";

const { items: repos } = await Repos.ListForAuthenticatedUser({ sort: "pushed", direction: "desc", perPage: 30 });

kaja.text("The repositories you can push to, by when anyone last did. Tap one for its week.");

kaja.table(repos, (repository) => ({
  repo: kaja.run("repo-pulse", { repo: repository.fullName }, { label: repository.fullName }),
  pushed: repository.pushedAt ?? "",
  "open issues": repository.openIssuesCount,
  stars: repository.stargazersCount,
}));
