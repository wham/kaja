// The whole movie catalog, a page at a time.
//
// The rows are an async generator, so the table only fetches a page when you
// page into it — a thousand films, and one call to start with.

import { kaja } from "kaja";
import { Theatre } from "theatre/service";

const catalog = kaja.table(
  ["id", "title", "director", "year", "runs", "genre", "language"],
  async function* () {
    for (let cursor = ""; ; ) {
      const page = await Theatre.ListMovies({ ids: [], genre: "", limit: 100, cursor });
      catalog.total(page.total);
      yield* page.movies.map((movie) => [movie.id, movie.title, movie.director, movie.year, `${movie.runtimeMinutes} min`, movie.genre, movie.language]);
      if (!(cursor = page.nextCursor)) return;
    }
  },
  { pageSize: 100 },
);
