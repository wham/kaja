// Say what you feel like, and the house does the rest.
//
// Three apps and three protocols. The concierge is an MCP server: you hand it
// a sentence and it hands back a screening and a row, having read the
// programme (OpenAPI) and the live seat map (gRPC) to decide. The script joins
// nothing by hand — a showId is the only identifier in the demo, and it goes
// straight from one app to the next.
//
// One call here spends money, so exactly one call is wrapped in kaja.approve:
// the run stops in front of it with the request drawn on the canvas, and
// nothing leaves until you press Approve.

import { kaja } from "kaja";
import { Tools as Concierge } from "concierge/mcp";
import { Seating, Section } from "seating/proto/seating";

const mood = await kaja.askStr("What do you feel like tonight?");
const party = await kaja.askInt("How many of you?");

// A tool with bad news reports it as a result rather than a failure — the call
// worked, the concierge just can't help — so what it said is in `content` and
// `structuredContent` is empty.
const suggestion = await Concierge.SuggestFilm({ mood, party });
const pick = suggestion.structuredContent;
if (!pick) throw new Error(suggestion.content[0]?.text ?? "The concierge had nothing to suggest.");

kaja.text(pick.why);

// What it nearly said instead. A table is how a script shows a list — never
// Markdown, never a string it built itself.
const shortlist = kaja.table(["", "film", "why"]);
shortlist.row("●", pick.title, pick.why);
for (const other of pick.runnersUp) {
  shortlist.row("○", other.title, other.why);
}

const best = await Concierge.BestSeats({ showId: pick.showId, party });
const seats = best.structuredContent;
if (!seats) throw new Error(best.content[0]?.text ?? `Nowhere for ${party} to sit together at ${pick.title}.`);

kaja.text(`${seats.section} row ${seats.row}, ${seats.seatIds.join(" and ")} — €${(seats.totalCents / 100).toFixed(2)}. ${seats.why}`);

// The concierge reserves nothing. This is the call that buys the seats, and
// the only one in the demo that can lose a race with the rest of the audience.
const booking = await kaja.approve(Seating.BookSeats({ showId: pick.showId, seatIds: seats.seatIds }));

const tickets = kaja.table(["seat", "section", "row", "price"]);
for (const seat of booking.seats) {
  tickets.row(seat.id, Section[seat.section], seat.row, `€${(seat.priceCents / 100).toFixed(2)}`);
}

const receipt = await Concierge.WriteConfirmation({ showId: pick.showId, seatIds: booking.seats.map((seat) => seat.id) });
if (receipt.structuredContent) kaja.text(receipt.structuredContent.note);
