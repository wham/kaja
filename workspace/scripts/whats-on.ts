// What is on in one town tonight — and how full each house is.
//
// The Theatre service keeps three lists, and the schedule is only the
// relationship: a movie id, a theater id, a time and a price. So a programme
// worth reading is a join, and this is what a join looks like in a table.
//
// Two kinds of cell do the filling-in, and they are different on purpose:
//
//   a promise    work the script already started. One ListMovies covers the
//                whole page, and every title and director on it waits for
//                that one call.
//   a function   work nobody has asked for yet. The seat count is a gRPC
//                call per row, so the table only makes it for the rows you
//                can actually see — and offers Retry on the ones that fail.
//
// The rows appear at once either way. The cells land afterwards.

import { kaja } from "kaja";
import { Theatre } from "theatre/service";
import { Seating } from "seating/proto/seating";

const { theaters } = await Theatre.ListTheaters({ city: "" });
const houses = new Map(theaters.map((theater) => [theater.id, theater]));

const city = await kaja.askSelect(
  "Which town are you in?",
  [...new Set(theaters.map((theater) => theater.city))].sort().map((name) => ({ label: name, value: name })),
);

const tonight = kaja.table(
  ["starts", "movie", "director", "theater", "price", "seats free"],
  async function* () {
    for (let cursor = ""; ; ) {
      const page = await Theatre.ListShows({ city, theaterId: "", movieId: "", limit: 25, cursor });
      tonight.total(page.total);

      // The left side of the join, for this page only: one lookup for every
      // film on it, started here and awaited by the cells below.
      const films = index(page.shows.map((show) => show.movieId));

      yield* page.shows.map((show) => {
        const house = houses.get(show.theaterId);
        return [
          new Date(show.startsAt).toLocaleString(undefined, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: house?.timeZone,
          }),
          films.then((movies) => movies.get(show.movieId)?.title ?? show.movieId),
          films.then((movies) => movies.get(show.movieId)?.director ?? ""),
          house?.name ?? show.theaterId,
          `$${(show.priceCents / 100).toFixed(2)}`,
          () => seatsFree(show.id),
        ];
      });

      if (!(cursor = page.nextCursor)) return;
    }
  },
  { pageSize: 25 },
);

async function index(ids: string[]) {
  const { movies } = await Theatre.ListMovies({ ids, genre: "", limit: 500, cursor: "" });
  return new Map(movies.map((movie) => [movie.id, movie]));
}

// Seats are the seating service's, not the Theatre's — a different app, a
// different protocol, and one call per screening.
async function seatsFree(showId: string) {
  const { seatMap } = await Seating.GetSeatMap({ showId });
  if (!seatMap) return "";
  return `${seatMap.available} of ${seatMap.available + seatMap.held + seatMap.sold}`;
}
