import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";
import { Seating, SeatStatus, Section } from "seating/proto/seating";

const programme = await TheKajaTheatre.ListShows({ limit: 100, cursor: "" });

const show = await kaja.askSelect(
  `Which film? The first 100 screenings of ${programme.total}.`,
  programme.shows.map((show) => ({ label: `${show.title} · ${show.director}, ${show.year}`, value: show })),
);

const { seatMap } = await Seating.GetSeatMap({ showId: show.id });
if (!seatMap) throw new Error(`No seat map for ${show.id}`);

kaja.text(`${show.title} — ${seatMap.available} free, ${seatMap.held} held, ${seatMap.sold} sold.`);

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
