import { kaja } from "kaja";
import { Tools as Concierge } from "concierge/mcp";
import { Theatre } from "theatre/service";
import { Seating, Section } from "seating/proto/seating";

const { theaters } = await Theatre.ListTheaters({ city: "" });
const city = await kaja.askSelect(
  "Where are you tonight?",
  [...new Set(theaters.map((theater) => theater.city))].sort().map((name) => ({ label: name, value: name })),
);

const mood = await kaja.askStr("And what do you feel like?");
const party = await kaja.askInt("How many of you?");

const suggestion = await Concierge.SuggestFilm({ mood, party, city, maxMinutes: 0 });
const pick = suggestion.structuredContent;
if (!pick) throw new Error(suggestion.content[0]?.text ?? "The concierge had nothing to suggest.");

kaja.text(pick.why);

const shortlist = kaja.table(["", "film", "where", "why"]);
shortlist.row("●", pick.title, pick.theater, pick.why);
for (const other of pick.runnersUp) {
  shortlist.row("○", other.title, other.theater, other.why);
}

const best = await Concierge.BestSeats({ showId: pick.showId, party });
const seats = best.structuredContent;
if (!seats) throw new Error(best.content[0]?.text ?? `Nowhere for ${party} to sit together at ${pick.title}.`);

kaja.text(`${pick.theater} — ${seats.section} row ${seats.row}, ${seats.seatIds.join(" and ")} for $${(seats.totalCents / 100).toFixed(2)}. ${seats.why}`);

const booking = await kaja.approve(Seating.BookSeats({ showId: pick.showId, seatIds: seats.seatIds }));

const tickets = kaja.table(["seat", "section", "row", "price"]);
for (const seat of booking.seats) {
  tickets.row(seat.id, Section[seat.section], seat.row, `$${(seat.priceCents / 100).toFixed(2)}`);
}

const receipt = await Concierge.WriteConfirmation({
  showId: pick.showId,
  seatIds: booking.seats.map((seat) => seat.id),
  name: "",
});
if (receipt.structuredContent) kaja.text(receipt.structuredContent.note);
