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

async function seatsFree(showId: string) {
  const { seatMap } = await Seating.GetSeatMap({ showId });
  if (!seatMap) return "";
  return `${seatMap.available} of ${seatMap.available + seatMap.held + seatMap.sold}`;
}
