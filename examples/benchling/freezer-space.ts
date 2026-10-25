import { kaja } from "kaja";
import { Boxes, Locations } from "benchling";

const where = kaja.input.location ?? (await kaja.askStr("Which freezer, fridge or shelf? (part of its name)"));
const { locations } = await Locations.ListLocations({ nameIncludes: where, archiveReason: "NOT_ARCHIVED", pageSize: 50 });
if (!locations.length) throw new Error(`No location's name includes "${where}".`);

const location =
  locations.length === 1
    ? locations[0]
    : await kaja.askSelect(
        "Which one?",
        locations.map((location) => ({ label: location.barcode ? `${location.name} (${location.barcode})` : location.name, value: location })),
      );

const boxes = kaja.table(["box", "barcode", "filled", "free", "empty tubes", ""]);
let free = 0;
let total = 0;

for (let nextToken = ""; ; ) {
  const page = await Boxes.ListBoxes({ ancestorStorageId: location.id, archiveReason: "NOT_ARCHIVED", sort: "name:asc", pageSize: 50, nextToken });
  for (const box of page.boxes) {
    free += box.emptyPositions;
    total += box.size;
    boxes.row(
      box.name,
      box.barcode,
      `${box.filledPositions} of ${box.size}`,
      box.emptyPositions,
      box.emptyContainers,
      kaja.run("box", { id: box.id }, { label: "Map" }),
    );
  }
  if (!(nextToken = page.nextToken)) break;
}

kaja.text(
  total
    ? `${location.name} has ${free} free positions across its boxes, ${Math.round((free / total) * 100)}% of ${total}.`
    : `${location.name} holds no boxes.`,
);
