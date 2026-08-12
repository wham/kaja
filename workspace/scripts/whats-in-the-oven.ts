// What the oven is doing right now.
//
// Four racks, and you are not the only baker: the bakery's own staff claim racks
// and bake on them all day, so the same call a few seconds from now is a
// different answer. The baker column says whose rack it is.
//
// The oven runs on demo time — a recipe's minutes are seconds in there — so run
// this twice in a row and you will watch a batch move from baking, to cooling,
// to the counter.

import { kaja } from "kaja";
import { Oven, RackState } from "oven/proto/oven";

const { oven } = await Oven.GetOven({});
if (!oven) throw new Error("The oven is not answering");

kaja.text(
  `${oven.celsius}°C · ${oven.freeRacks} of ${oven.racks.length} racks free · ` +
    `${oven.cooling} cooling · ${oven.onCounter} on the counter · ${oven.bakedToday} baked today` +
    (oven.scorchedToday > 0 ? ` · ${oven.scorchedToday} scorched, which happens` : ""),
);

const table = kaja.table(["rack", "state", "cookie", "trays", "cookies", "baker", "left"]);
for (const rack of oven.racks) {
  table.row(
    rack.number,
    RackState[rack.state].toLowerCase(),
    rack.cookieName || "—",
    rack.trays || "—",
    rack.cookies || "—",
    rack.baker || "—",
    countdown(rack.until),
  );
}

// A rack says when its current state runs out: the claim expires, the bake
// finishes, the batch is cool enough to move.
function countdown(until?: { seconds: string }) {
  if (!until) return "—";
  const seconds = Math.round(Number(until.seconds) - Date.now() / 1000);
  return seconds > 0 ? `${seconds}s` : "any moment";
}
