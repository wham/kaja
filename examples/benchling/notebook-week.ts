import { kaja } from "kaja";
import { Entries } from "benchling";

const days = Number(kaja.input.days ?? 7);
const since = new Date(Date.now() - days * 86_400_000);

const entries = kaja.table(["entry", "title", "authors", "review", "modified", ""]);
const byStatus = new Map<string, number>();
const byAuthor = new Map<string, number>();

for (let nextToken = ""; ; ) {
  const page = await Entries.ListEntries({ modifiedAt: `> ${since.toISOString()}`, sort: "modifiedAt:desc", pageSize: 50, nextToken });
  for (const entry of page.entries) {
    const status = entry.reviewRecord?.status ?? "IN_PROGRESS";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    for (const author of entry.authors) byAuthor.set(author.name, (byAuthor.get(author.name) ?? 0) + 1);
    entries.row(
      entry.displayId,
      entry.name,
      entry.authors.map((author) => author.name).join(", "),
      status.toLowerCase().replace(/_/g, " "),
      new Date(entry.modifiedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
      entry.webUrl,
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

const total = [...byStatus.values()].reduce((sum, n) => sum + n, 0);
kaja.text(
  total
    ? `${total} entries touched in the last ${days} days, by ${byAuthor.size} ${byAuthor.size === 1 ? "author" : "authors"}.`
    : `Nobody has written in the notebook in the last ${days} days.`,
);

if (total) {
  const writers = kaja.table(["author", "entries"]);
  for (const [author, n] of [...byAuthor].sort((a, b) => b[1] - a[1])) writers.row(author, n);

  const review = kaja.table(["review status", "entries"]);
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) review.row(status.toLowerCase().replace(/_/g, " "), n);
}
