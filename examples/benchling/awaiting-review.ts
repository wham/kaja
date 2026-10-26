import { kaja } from "kaja";
import { Entries } from "benchling";

const entries = kaja.pages((nextToken) => Entries.ListEntries({ reviewStatus: "NEEDS_REVIEW", sort: "modifiedAt:asc", pageSize: 50, nextToken }));

const queue = kaja.table({ title: "Waiting for review" });
const load = new Map<string, number>();
let oldest: { name: string; days: number } | undefined;

for await (const entry of entries) {
  const days = Math.floor((Date.now() - new Date(entry.modifiedAt).getTime()) / 86_400_000);
  if (!oldest || days > oldest.days) oldest = { name: entry.name, days };
  for (const reviewer of entry.assignedReviewers) load.set(reviewer.name, (load.get(reviewer.name) ?? 0) + 1);
  queue.row({
    entry: entry.displayId,
    title: entry.name,
    authors: entry.authors.map((author) => author.name).join(", "),
    reviewers: entry.assignedReviewers.map((reviewer) => reviewer.name).join(", ") || "nobody",
    waiting: entry.modifiedAt,
    link: entry.webUrl,
  });
}

if (!oldest) {
  kaja.text("Nothing is waiting for review.");
} else {
  kaja.text(`The longest wait is ${oldest.days} days, on ${oldest.name}.`);
  kaja.table(
    [...load].sort((a, b) => b[1] - a[1]),
    ([reviewer, waiting]) => ({ reviewer, "entries waiting": waiting }),
  );
}
