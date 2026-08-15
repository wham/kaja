// One screening's house, row by row.
//
// Picking the screening is the join again, in miniature: the schedule says
// which film is at which house, and the other two lists say what either of
// those is called.

import { kaja } from "kaja";
import { Theatre } from "theatre/service";
import { Seating, SeatStatus, Section } from "seating/proto/seating";

const { theaters } = await Theatre.ListTheaters({ city: "" });
const house = await kaja.askSelect(
  "Which house?",
  theaters.map((theater) => ({ label: `${theater.name} · ${theater.city}, ${theater.state}`, value: theater })),
);

const page = await Theatre.ListShows({ theaterId: house.id, movieId: "", city: "", limit: 25, cursor: "" });
const { movies } = await Theatre.ListMovies({
  ids: page.shows.map((show) => show.movieId),
  genre: "",
  limit: 500,
  cursor: "",
});
const films = new Map(movies.map((movie) => [movie.id, movie]));

const screening = await kaja.askSelect(
  `Which screening? The next ${page.shows.length} of ${page.total} at ${house.name}.`,
  page.shows.map((show) => ({
    label: `${films.get(show.movieId)?.title ?? show.movieId} · ${new Date(show.startsAt).toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: house.timeZone,
    })}`,
    value: show,
  })),
);

const { seatMap } = await Seating.GetSeatMap({ showId: screening.id });
if (!seatMap) throw new Error(`No seat map for ${screening.id}`);

const film = films.get(screening.movieId);
kaja.text(`${film?.title ?? screening.movieId} at ${house.name} — ${seatMap.available} free, ${seatMap.held} held, ${seatMap.sold} sold.`);

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
