import { kaja } from "kaja";
import { Pulls, Search } from "github";

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
  kaja.table(found.items, (pr) => {
    const [owner, repo] = pr.repositoryUrl.split("/").slice(-2);
    return {
      "pull request": pr.draft ? `Draft: ${pr.title}` : pr.title,
      reviews: async () => {
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
      repo: `${owner}/${repo}#${pr.number}`,
      updated: pr.updatedAt,
    };
  });
}
