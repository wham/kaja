// Bake a batch, with the two calls that cost something held for approval.
//
// Three apps and three protocols in one script: the book is OpenAPI over HTTP,
// the oven is gRPC, and the kitchen is an MCP server whose tools are methods
// like any other app's. They are joined by nothing but the cookie's id.
//
// The reads go out as they are written. The two writes are wrapped in
// kaja.approve, which draws the call and the request it is about to send on the
// canvas and stops the run in front of it: nothing leaves until it is approved,
// and Stop ends the script there.

import { kaja } from "kaja";
import { Bakebook } from "bakebook/service";
import { Oven } from "oven/proto/oven";
import { Tools } from "kitchen/mcp";

const { items: cookies } = await Bakebook.ListCookies({});
const cookie = await kaja.askSelect(
  "What are we baking?",
  cookies.map((cookie) => ({ label: `${cookie.name} · ${cookie.texture}`, value: cookie })),
);

const asked = await kaja.askInt(`How many trays? Each one holds ${cookie.perTray}`);
const trays = Math.min(3, Math.max(1, asked));
if (trays !== asked) kaja.text(`A rack holds three trays, so we are baking ${trays}.`);

// The kitchen turns the recipe into a shopping list, and knows what the shelf
// is out of — which the book, being a catalog, has no way to say.
const { structuredContent: plan } = await Tools.Scale({ cookieId: cookie.id, cookies: trays * cookie.perTray });
if (!plan) throw new Error("The kitchen did not answer");

const shopping = kaja.table(["ingredient", "weigh out", "on the shelf"]);
for (const line of plan.lines) {
  shopping.row(line.ingredient, `${line.grams} g`, line.inStock ? "yes" : "no");
}

for (const missing of plan.missing) {
  const { structuredContent: swap } = await Tools.Substitute({ ingredient: missing, why: "the shelf is empty" });
  if (swap) kaja.text(`No ${missing} today. Use ${swap.use} — ${swap.ratio}. ${swap.note}`);
}

// Claiming a rack costs nothing but the rack, and only until it expires.
const { claim } = await kaja.approve(Oven.ClaimRack({ cookieId: cookie.id, trays }));
if (!claim) throw new Error("No rack — all four are busy. Run whats-in-the-oven to see when one frees up.");

kaja.text(`Rack ${claim.rackNumber} is yours until ${time(claim.expiresAt)}. ${claim.doughGrams} g of dough to weigh out.`);

// This one spends the dough. There is no unbaking a batch.
const { batch } = await kaja.approve(Oven.StartBake({ claimId: claim.id }));
if (!batch) throw new Error("The bake never started — the claim may have expired");

kaja.text(`${batch.cookies} ${cookie.name} on rack ${batch.rackNumber} at ${batch.celsius}°C, out at ${time(batch.readyAt)}.`);

const { structuredContent: pairing } = await Tools.Pair({ cookieId: cookie.id });
if (pairing) kaja.text(`Serve with ${pairing.drink}. ${pairing.why}`);

function time(at?: { seconds: string }) {
  return new Date(Number(at?.seconds ?? 0) * 1000).toLocaleTimeString();
}
