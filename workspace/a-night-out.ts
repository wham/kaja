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

kaja.table([pick, ...pick.runnersUp], (film) => ({ pick: film === pick ? "●" : "○", film: film.title, where: film.theater, why: film.why }), {
  title: "The shortlist",
});

const best = await Concierge.BestSeats({ showId: pick.showId, party });
const seats = best.structuredContent;
if (!seats) throw new Error(best.content[0]?.text ?? `Nowhere for ${party} to sit together at ${pick.title}.`);

kaja.text(`${pick.theater} — ${seats.section} row ${seats.row}, ${seats.seatIds.join(" and ")} for $${(seats.totalCents / 100).toFixed(2)}. ${seats.why}`);

const booking = await kaja.approve(Seating.BookSeats({ showId: pick.showId, seatIds: seats.seatIds }));

kaja.table(booking.seats, (seat) => ({ seat: seat.id, section: Section[seat.section], row: seat.row, price: `$${(seat.priceCents / 100).toFixed(2)}` }), {
  title: "Your tickets",
});

const receipt = await Concierge.WriteConfirmation({
  showId: pick.showId,
  seatIds: booking.seats.map((seat) => seat.id),
  name: "",
});
if (receipt.structuredContent) kaja.text(receipt.structuredContent.note);
