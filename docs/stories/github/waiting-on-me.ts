import { kaja } from "kaja";
import { Issues, Search } from "github";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const [reviews, assigned] = await Promise.all([
  Search.IssuesAndPullRequests({ q: "is:pr is:open review-requested:@me archived:false", sort: "updated", order: "desc", perPage: 30 }),
  Issues.ListForAuthenticatedUser({ filter: "assigned", state: "open", sort: "updated", perPage: 30 }),
]);

kaja.text(`${reviews.totalCount} pull requests want your review.`);
const toReview = kaja.table(["repo", "#", "title", "author", "waiting"]);
for (const pr of reviews.items) {
  const repo = pr.repositoryUrl.split("/").slice(-2).join("/");
  toReview.row(repo, `#${pr.number}`, pr.title, pr.user?.login ?? "", ago(pr.updatedAt));
}

kaja.text(`${assigned.items.length} open issues and pull requests are assigned to you.`);
const mine = kaja.table(["repo", "#", "title", "kind", "comments", "updated"]);
for (const item of assigned.items) {
  mine.row(item.repository?.fullName ?? "", `#${item.number}`, item.title, item.pullRequest ? "PR" : "issue", item.comments, ago(item.updatedAt));
}
