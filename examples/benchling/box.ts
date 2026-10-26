import { kaja } from "kaja";
import { Boxes } from "benchling";

const id = kaja.input.id ?? (await kaja.askStr("Which box? (box_…)"));
const box = await Boxes.GetBox({ boxId: id });

const wells = new Map<string, string>();
for await (const container of kaja.pages((nextToken) => Boxes.ListBoxContents({ boxId: id, pageSize: 100, nextToken }))) {
  const what = container.contents
    .map((content) => content.entity?.name ?? content.batch?.name ?? "")
    .filter(Boolean)
    .join(" + ");
  const status = container.checkoutRecord?.status === "CHECKED_OUT" ? " ⇢" : "";
  wells.set(container.gridPosition, (what || container.name || "empty tube") + status);
}

const positions = [...wells.keys()].map((position) => /^([A-Z]+)(\d+)$/.exec(position)).filter((match) => match !== null);
const side = Math.round(Math.sqrt(box.size));
const rows = Math.max(side, ...positions.map((match) => match[1].charCodeAt(0) - 64));
const columns = Math.max(Math.ceil(box.size / rows), ...positions.map((match) => Number(match[2])));

kaja.text(`${box.name}${box.barcode ? ` (${box.barcode})` : ""}: ${box.filledPositions} of ${box.size} filled, ${box.emptyPositions} free. ${box.webUrl}`);

kaja.table(
  Array.from({ length: rows }, (_, row) => String.fromCharCode(65 + row)),
  (letter) =>
    new Map([["", letter], ...Array.from({ length: columns }, (_, column) => [String(column + 1), wells.get(`${letter}${column + 1}`) ?? "·"] as const)]),
);
