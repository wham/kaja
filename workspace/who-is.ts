import { kaja } from "kaja";
import { Repos, Users } from "github";

const username = (kaja.input.user || (await kaja.askStr("Which GitHub user?"))).trim();

const [person, repos] = await Promise.all([Users.GetByUsername({ username }), Repos.ListForUser({ username, sort: "pushed", direction: "desc", perPage: 30 })]);

kaja.text(
  [
    `${person.name || person.login}${person.location ? `, ${person.location}` : ""}.`,
    `${person.followers.toLocaleString()} followers, ${person.publicRepos.toLocaleString()} public repositories, on GitHub since ${new Date(person.createdAt).getFullYear()}.`,
    person.bio ?? "",
  ].join(" "),
);

kaja.table(
  repos.items.filter((repository) => !repository.fork),
  (repository) => ({
    repo: kaja.run("repo-pulse", { repo: repository.fullName }, { label: repository.name }),
    stars: repository.stargazersCount ?? 0,
    language: repository.language ?? "",
    pushed: repository.pushedAt ?? "",
  }),
  { title: "Their own repositories, by last push" },
);
