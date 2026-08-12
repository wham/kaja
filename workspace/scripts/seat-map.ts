// Where the free seats are, for a film you pick.
//
// Two apps in one script: the programme comes from an OpenAPI service over
// HTTP, the seats from a gRPC one, and the script joins them on the id. A
// script is not bound to an app — it binds to whatever its imports resolve to
// at run time.
//
// kaja.askSelect parks the run on the canvas until the question is answered,
// so there is no reason to hard-code an id to try a second film.

import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";
import { Seating, SeatStatus, Section } from "seating/proto/seating";

const { items: shows } = await TheKajaTheatre.ListShows({});

const show = await kaja.askSelect(
  "Which film?",
  shows.map((show) => ({ label: `${show.title} · ${show.director}, ${show.year}`, value: show })),
);

const { seatMap } = await Seating.GetSeatMap({ showId: show.id });
if (!seatMap) throw new Error(`No seat map for ${show.id}`);

kaja.text(`${show.title} — ${seatMap.available} free, ${seatMap.held} held, ${seatMap.sold} sold.`);

// The house is busy: other customers are booking while this runs, so the same
// call a minute from now is a different answer.
const table = kaja.table(["section", "row", "free", "held", "sold", "seats"]);
for (const section of seatMap.sections) {
  for (const row of section.rows) {
    const count = (status: SeatStatus) => row.seats.filter((seat) => seat.status === status).length;
    table.row(
      Section[section.section],
      row.letter,
      count(SeatStatus.AVAILABLE),
      count(SeatStatus.HELD),
      count(SeatStatus.SOLD),
      row.seats
        .filter((seat) => seat.status === SeatStatus.AVAILABLE)
        .map((seat) => seat.number)
        .join(" "),
    );
  }
}
