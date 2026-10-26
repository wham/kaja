import { kaja } from "kaja";
import { Theatre } from "theatre/service";

const movies = kaja.pages((cursor) => Theatre.ListMovies({ limit: 100, cursor }));

kaja.table(
  movies,
  (movie) => ({
    id: movie.id,
    title: movie.title,
    director: movie.director,
    year: movie.year,
    runs: `${movie.runtimeMinutes} min`,
    genre: movie.genre,
    language: movie.language,
  }),
  { title: "Now showing", pageSize: 100 },
);
