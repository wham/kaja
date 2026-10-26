import { kaja } from "kaja";
import { Issues, Search } from "github";

const [reviews, assigned] = await Promise.all([
  Search.IssuesAndPullRequests({ q: "is:pr is:open review-requested:@me archived:false", sort: "updated", order: "desc", perPage: 30 }),
  Issues.ListForAuthenticatedUser({ filter: "assigned", state: "open", sort: "updated", perPage: 30 }),
]);

if (reviews.items.length === 0) {
  kaja.text("Nobody is waiting on your review.");
} else {
  kaja.text(`${reviews.totalCount} pull requests want your review.`);
  kaja.table(reviews.items, (pr) => ({
    "pull request": pr.title,
    author: pr.user?.login ?? "",
    repo: `${pr.repositoryUrl.split("/").slice(-2).join("/")}#${pr.number}`,
    waiting: pr.updatedAt,
  }));
}

if (assigned.items.length === 0) {
  kaja.text("Nothing open is assigned to you.");
} else {
  kaja.text(`${assigned.items.length} open issues and pull requests are assigned to you.`);
  kaja.table(assigned.items, (item) => ({
    title: item.title,
    kind: item.pullRequest ? "PR" : "issue",
    repo: `${item.repository?.fullName ?? ""}#${item.number}`,
    updated: item.updatedAt,
  }));
}
