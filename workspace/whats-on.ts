import { kaja } from "kaja";
import { Theatre } from "theatre/service";
import { Seating } from "seating/proto/seating";

const { theaters } = await Theatre.ListTheaters({ city: "" });
const houses = new Map(theaters.map((theater) => [theater.id, theater]));

const city = await kaja.askSelect(
  "Which town are you in?",
  [...new Set(theaters.map((theater) => theater.city))].sort().map((name) => ({ label: name, value: name })),
);

const shows = kaja.pages((cursor) => Theatre.ListShows({ city, limit: 25, cursor }), {
  items: (page) => {
    const films = index(page.shows.map((show) => show.movieId));
    return page.shows.map((show) => ({ show, films }));
  },
});

kaja.table(
  shows,
  ({ show, films }) => {
    const house = houses.get(show.theaterId);
    return {
      starts: new Date(show.startsAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: house?.timeZone,
      }),
      movie: films.then((movies) => movies.get(show.movieId)?.title ?? show.movieId),
      director: films.then((movies) => movies.get(show.movieId)?.director ?? ""),
      theater: house?.name ?? show.theaterId,
      price: `$${(show.priceCents / 100).toFixed(2)}`,
      "seats free": () => seatsFree(show.id),
    };
  },
  { title: `Tonight in ${city}`, pageSize: 25 },
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
