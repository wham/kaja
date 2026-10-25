import { kaja } from "kaja";
import { Pulls, Search } from "github";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const found = await Search.IssuesAndPullRequests({
  q: "is:pr is:open author:@me archived:false",
  sort: "updated",
  order: "desc",
  perPage: 30,
});

if (found.items.length === 0) {
  kaja.text("You have no open pull requests.");
} else {
  kaja.text(`${found.totalCount} open pull requests of yours, most recently touched first.`);
  const table = kaja.table(["pull request", "reviews", "repo", "updated"]);
  for (const pr of found.items) {
    const [owner, repo] = pr.repositoryUrl.split("/").slice(-2);
    table.row(
      pr.draft ? `Draft: ${pr.title}` : pr.title,
      async () => {
        const { items: reviews } = await Pulls.ListReviews({ owner, repo, pullNumber: pr.number });
        const latest = new Map<string, string>();
        for (const review of reviews) {
          if (review.user && review.state !== "COMMENTED") latest.set(review.user.login, review.state);
        }
        if (latest.size === 0) return "none yet";
        const verdicts = [...latest.values()];
        const approved = verdicts.filter((state) => state === "APPROVED").length;
        const changes = verdicts.filter((state) => state === "CHANGES_REQUESTED").length;
        return [approved && `${approved} approved`, changes && `${changes} want changes`].filter(Boolean).join(", ");
      },
      `${owner}/${repo}#${pr.number}`,
      ago(pr.updatedAt),
    );
  }
}
