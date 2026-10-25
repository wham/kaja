import { kaja } from "kaja";
import { Boxes } from "benchling";

const id = kaja.input.id ?? (await kaja.askStr("Which box? (box_…)"));
const box = await Boxes.GetBox({ boxId: id });

const wells = new Map<string, string>();
for (let nextToken = ""; ; ) {
  const page = await Boxes.ListBoxContents({ boxId: id, pageSize: 100, nextToken });
  for (const container of page.containers) {
    const what = container.contents.map((content) => content.entity?.name ?? content.batch?.name ?? "").filter(Boolean).join(" + ");
    const status = container.checkoutRecord?.status === "CHECKED_OUT" ? " ⇢" : "";
    wells.set(container.gridPosition, (what || container.name || "empty tube") + status);
  }
  if (!(nextToken = page.nextToken)) break;
}

const positions = [...wells.keys()].map((position) => /^([A-Z]+)(\d+)$/.exec(position)).filter((match) => match !== null);
const side = Math.round(Math.sqrt(box.size));
const rows = Math.max(side, ...positions.map((match) => match[1].charCodeAt(0) - 64));
const columns = Math.max(Math.ceil(box.size / rows), ...positions.map((match) => Number(match[2])));

kaja.text(`${box.name}${box.barcode ? ` (${box.barcode})` : ""}: ${box.filledPositions} of ${box.size} filled, ${box.emptyPositions} free. ${box.webUrl}`);

const grid = kaja.table(["", ...Array.from({ length: columns }, (_, column) => String(column + 1))]);
for (let row = 0; row < rows; row++) {
  const letter = String.fromCharCode(65 + row);
  grid.row(letter, ...Array.from({ length: columns }, (_, column) => wells.get(`${letter}${column + 1}`) ?? "·"));
}
