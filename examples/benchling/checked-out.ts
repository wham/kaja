import { kaja } from "kaja";
import { Containers } from "benchling";

const containers = kaja.pages((nextToken) =>
  Containers.ListContainers({ checkoutStatus: "CHECKED_OUT,RESERVED", sort: "modifiedAt:asc", pageSize: 100, nextToken }),
);

const out = kaja.table({ title: "Checked out" });
const byPerson = new Map<string, number>();

for await (const container of containers) {
  const record = container.checkoutRecord;
  const who = record?.assignee?.name ?? "unknown";
  byPerson.set(who, (byPerson.get(who) ?? 0) + 1);
  out.row({
    container: container.name,
    barcode: container.barcode,
    holds: container.contents
      .map((content) => content.entity?.name ?? content.batch?.name ?? "")
      .filter(Boolean)
      .join(" + "),
    with: record?.status === "RESERVED" ? `${who} (reserved)` : who,
    since: record?.modifiedAt ?? "",
    comment: record?.comment ?? "",
  });
}

if (!byPerson.size) {
  kaja.text("Every container is on its shelf.");
} else {
  kaja.table(
    [...byPerson].sort((a, b) => b[1] - a[1]),
    ([holder, containers]) => ({ holder, containers }),
  );
}
