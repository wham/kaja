import { kaja } from "kaja";
import { Entries } from "benchling";

const queue = kaja.table(["entry", "title", "authors", "reviewers", "waiting", ""]);
const load = new Map<string, number>();
let oldest: { name: string; days: number } | undefined;

for (let nextToken = ""; ; ) {
  const page = await Entries.ListEntries({ reviewStatus: "NEEDS_REVIEW", sort: "modifiedAt:asc", pageSize: 50, nextToken });
  for (const entry of page.entries) {
    const days = Math.floor((Date.now() - new Date(entry.modifiedAt).getTime()) / 86_400_000);
    if (!oldest || days > oldest.days) oldest = { name: entry.name, days };
    for (const reviewer of entry.assignedReviewers) load.set(reviewer.name, (load.get(reviewer.name) ?? 0) + 1);
    queue.row(
      entry.displayId,
      entry.name,
      entry.authors.map((author) => author.name).join(", "),
      entry.assignedReviewers.map((reviewer) => reviewer.name).join(", ") || "nobody",
      `${days} d`,
      entry.webUrl,
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

if (!oldest) {
  kaja.text("Nothing is waiting for review.");
} else {
  kaja.text(`The longest wait is ${oldest.days} days, on ${oldest.name}.`);
  const reviewers = kaja.table(["reviewer", "entries waiting"]);
  for (const [name, n] of [...load].sort((a, b) => b[1] - a[1])) reviewers.row(name, n);
}
