import { kaja } from "kaja";
import { Search } from "github";

const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const found = await Search.Repos({ q: `created:>${since}`, sort: "stars", order: "desc", perPage: 30 });

kaja.text(`The most starred of ${found.totalCount.toLocaleString()} repositories created since ${since}.`);

kaja.table(found.items, (repository) => ({
  repo: kaja.run("repo-pulse", { repo: repository.fullName }, { label: repository.fullName }),
  stars: repository.stargazersCount,
  language: repository.language ?? "",
  about: repository.description ?? "",
  created: repository.createdAt,
}));
