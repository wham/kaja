import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";

const programme = kaja.table(
  ["id", "film", "director", "year", "runs", "starts", "from"],
  async function* () {
    for (let cursor = ""; ; ) {
      const page = await TheKajaTheatre.ListShows({ limit: 100, cursor });
      programme.total(page.total);
      yield* page.shows.map((show) => [
        show.id,
        show.title,
        show.director,
        show.year,
        `${show.runtimeMinutes} min`,
        new Date(show.startsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
        `€${(show.basePriceCents / 100).toFixed(2)}`,
      ]);
      if (!(cursor = page.nextCursor)) return;
    }
  },
  { pageSize: 100 },
);
