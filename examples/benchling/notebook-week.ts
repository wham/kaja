import { kaja } from "kaja";
import { Entries } from "benchling";

const days = Number(kaja.input.days ?? 7);
const since = new Date(Date.now() - days * 86_400_000);

const entries = kaja.pages((nextToken) => Entries.ListEntries({ modifiedAt: `> ${since.toISOString()}`, sort: "modifiedAt:desc", pageSize: 50, nextToken }));

const table = kaja.table({ title: `The notebook, last ${days} days` });
const byStatus = new Map<string, number>();
const byAuthor = new Map<string, number>();

for await (const entry of entries) {
  const status = entry.reviewRecord?.status ?? "IN_PROGRESS";
  byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  for (const author of entry.authors) byAuthor.set(author.name, (byAuthor.get(author.name) ?? 0) + 1);
  table.row({
    entry: entry.displayId,
    title: entry.name,
    authors: entry.authors.map((author) => author.name).join(", "),
    review: status.toLowerCase().replace(/_/g, " "),
    modified: entry.modifiedAt,
    link: entry.webUrl,
  });
}

const total = [...byStatus.values()].reduce((sum, n) => sum + n, 0);
kaja.text(
  total
    ? `${total} entries touched in the last ${days} days, by ${byAuthor.size} ${byAuthor.size === 1 ? "author" : "authors"}.`
    : `Nobody has written in the notebook in the last ${days} days.`,
);

if (total) {
  kaja.table(
    [...byAuthor].sort((a, b) => b[1] - a[1]),
    ([author, entries]) => ({ author, entries }),
  );

  kaja.table(
    [...byStatus].sort((a, b) => b[1] - a[1]),
    ([status, entries]) => ({ "review status": status.toLowerCase().replace(/_/g, " "), entries }),
  );
}
