import { kaja } from "kaja";
import { Box, Location } from "benchling";

const locations = [];
for await (const location of kaja.pages((nextToken) => Location.List({ pageSize: 100, nextToken }))) {
  locations.push(location);
}
if (!locations.length) throw new Error("Benchling has no locations.");

const location = await kaja.askSelect(
  "Which freezer, fridge or shelf?",
  locations
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((location) => ({ label: location.barcode ? `${location.name} (${location.barcode})` : location.name, value: location })),
);

const table = kaja.table({ title: location.name });
let free = 0;
let total = 0;

for await (const box of kaja.pages((nextToken) => Box.List({ parentStorageEq: location.id, pageSize: 50, nextToken }))) {
  free += box.availableCapacity;
  total += box.totalCapacity;
  table.row({
    box: kaja.run("box", { id: box.id }, { label: box.name }),
    barcode: box.barcode,
    filled: `${box.occupiedCapacity} of ${box.totalCapacity}`,
    free: box.availableCapacity,
    "empty tubes": box.emptyContainers,
  });
}

kaja.text(
  total
    ? `${location.name} has ${free} free positions across its boxes, ${Math.round((free / total) * 100)}% of ${total}.`
    : `${location.name} holds no boxes of its own.`,
);
