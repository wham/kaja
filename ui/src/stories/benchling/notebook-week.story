import { kaja } from "kaja";
import { Entry, User } from "benchling";

const days = Number(kaja.input.days ?? 7);
const since = new Date(Date.now() - days * 86_400_000).toISOString();

const people = new Map<string, PromiseLike<string>>();
const person = (id: string) => {
  if (!people.has(id))
    people.set(
      id,
      User.Get({ userId: id }).then((user) => user?.name ?? ""),
    );
  return people.get(id)!;
};

const entries = kaja.pages((nextToken) => Entry.List({ modifiedAtGte: since, sort: "modifiedAt:desc", pageSize: 50, nextToken, earlyAccess: "true" }));

const table = kaja.table({ title: `The notebook, last ${days} days` });
const byCreator = new Map<string, number>();
let total = 0;

for await (const entry of entries) {
  total++;
  if (entry.creator) byCreator.set(entry.creator.id, (byCreator.get(entry.creator.id) ?? 0) + 1);
  table.row({
    entry: entry.displayId,
    title: entry.name,
    "created by": entry.creator ? () => person(entry.creator!.id) : "",
    created: entry.createdAt,
    modified: entry.modifiedAt,
    link: entry.webUrl,
  });
}

kaja.text(
  total
    ? `${total} entries touched in the last ${days} days, started by ${byCreator.size} ${byCreator.size === 1 ? "person" : "people"}.`
    : `Nobody has written in the notebook in the last ${days} days.`,
);

if (total) {
  kaja.table(
    [...byCreator].sort((a, b) => b[1] - a[1]),
    ([id, entries]) => ({ "started by": () => person(id), entries }),
  );
}
