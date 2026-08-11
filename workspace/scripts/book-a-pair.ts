// Buy two seats together, with the purchase held for approval.
//
// The reads go out as they are written. The two writes are wrapped in
// kaja.approve, which draws the call and the request it is about to send on the
// canvas and stops the run in front of it: nothing leaves until it is approved,
// and Stop ends the script there.

import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";
import { Seating, SeatStatus, Section } from "seating/proto/seating";

const { items: shows } = await TheKajaTheatre.ListShows({});
const show = await kaja.askSelect(
  "Which show?",
  shows.map((show) => ({ label: `${show.title} · ${show.genre}`, value: show })),
);

const { seatMap } = await Seating.GetSeatMap({ showId: show.id });
if (!seatMap) throw new Error(`No seat map for ${show.id}`);

// Two free seats next to each other, cheapest first.
const pairs = [];
for (const section of seatMap.sections) {
  for (const row of section.rows) {
    const free = row.seats.filter((seat) => seat.status === SeatStatus.AVAILABLE).sort((a, b) => a.number - b.number);
    for (let i = 0; i + 1 < free.length; i++) {
      if (free[i + 1].number === free[i].number + 1) {
        pairs.push({ section: section.section, letter: row.letter, seats: [free[i], free[i + 1]] });
      }
    }
  }
}
const pair = pairs.sort((a, b) => a.seats[0].priceCents - b.seats[0].priceCents)[0];

if (!pair) throw new Error(`No two seats together left for ${show.title}`);

const total = pair.seats.reduce((sum, seat) => sum + seat.priceCents, 0);
kaja.text(
  `${show.title}: ${Section[pair.section]} row ${pair.letter}, seats ${pair.seats.map((seat) => seat.number).join(" and ")} — €${(total / 100).toFixed(2)}`,
);

const { hold } = await kaja.approve(Seating.HoldSeats({ showId: show.id, seatIds: pair.seats.map((seat) => seat.id) }));
if (!hold) throw new Error("The hold was not granted");

kaja.text(`Held until ${new Date(Number(hold.expiresAt?.seconds ?? 0) * 1000).toLocaleTimeString()}.`);

const { seats } = await kaja.approve(Seating.ConfirmSeats({ holdId: hold.id }));

const table = kaja.table(["seat", "section", "row", "number", "price"]);
for (const seat of seats) {
  table.row(seat.id, Section[seat.section], seat.row, seat.number, `€${(seat.priceCents / 100).toFixed(2)}`);
}
