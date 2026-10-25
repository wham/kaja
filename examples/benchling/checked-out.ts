import { kaja } from "kaja";
import { Containers } from "benchling";

const out = kaja.table(["container", "barcode", "holds", "with", "since", "comment"]);
const byPerson = new Map<string, number>();

for (let nextToken = ""; ; ) {
  const page = await Containers.ListContainers({ checkoutStatus: "CHECKED_OUT,RESERVED", sort: "modifiedAt:asc", pageSize: 100, nextToken });
  for (const container of page.containers) {
    const record = container.checkoutRecord;
    const who = record?.assignee?.name ?? "unknown";
    byPerson.set(who, (byPerson.get(who) ?? 0) + 1);
    out.row(
      container.name,
      container.barcode,
      container.contents.map((content) => content.entity?.name ?? content.batch?.name ?? "").filter(Boolean).join(" + "),
      record?.status === "RESERVED" ? `${who} (reserved)` : who,
      record?.modifiedAt ? `${Math.floor((Date.now() - new Date(record.modifiedAt).getTime()) / 86_400_000)} d` : "",
      record?.comment ?? "",
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

if (!byPerson.size) {
  kaja.text("Every container is on its shelf.");
} else {
  const people = kaja.table(["holder", "containers"]);
  for (const [who, n] of [...byPerson].sort((a, b) => b[1] - a[1])) people.row(who, n);
}
