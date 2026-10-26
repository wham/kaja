import { kaja } from "kaja";
import { Search } from "github";

const language = await kaja.askSelect(
  "Which language?",
  ["Go", "TypeScript", "Python", "Rust", "Swift"].map((name) => ({ label: name, value: name.toLowerCase() })),
);

const issues = kaja.pages(
  (page) =>
    Search.IssuesAndPullRequests({
      q: `label:"good first issue" is:issue is:open no:assignee language:${language}`,
      sort: "created",
      order: "desc",
      perPage: 25,
      page,
    }),
  { page: 1, items: (found) => found.items },
);

kaja.table(
  issues,
  (issue) => ({
    issue: issue.title,
    repo: issue.repositoryUrl.split("/").slice(-2).join("/"),
    comments: issue.comments,
    opened: issue.createdAt,
  }),
  { title: "Good first issues nobody has taken", pageSize: 25 },
);
