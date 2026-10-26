import { kaja } from "kaja";
import { Box, Container } from "benchling";

const id = kaja.input.id ?? (await kaja.askStr("Which box? (box_…)"));
const box = await Box.Get({ boxId: id });

const wells = new Map<string, string>();
let rows = Math.round(Math.sqrt(box.totalCapacity));
let columns = Math.ceil(box.totalCapacity / Math.max(rows, 1));

for await (const container of kaja.pages((nextToken) => Container.List({ parentStorageEq: id, pageSize: 100, nextToken }))) {
  const at = container.coordinates;
  if (!at) continue;
  rows = Math.max(rows, at.row + 1);
  columns = Math.max(columns, at.column + 1);
  const status = container.checkoutRecord?.status === "CHECKED_OUT" ? " ⇢" : "";
  wells.set(`${at.row}:${at.column}`, (container.contents.length ? container.name : "empty tube") + status);
}

kaja.text(`${box.name}${box.barcode ? ` (${box.barcode})` : ""}: ${box.occupiedCapacity} of ${box.totalCapacity} filled, ${box.availableCapacity} free.`);

kaja.table(
  Array.from({ length: rows }, (_, row) => row),
  (row) =>
    new Map([
      ["", String.fromCharCode(65 + row)],
      ...Array.from({ length: columns }, (_, column) => [String(column + 1), wells.get(`${row}:${column}`) ?? "·"] as const),
    ]),
);
