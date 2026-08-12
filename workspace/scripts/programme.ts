// This week at The Kaja Theatre, drawn as a table.
//
// The shortest thing a script can be: one call, no parameters, one table.
// Everything a script has to say it draws on the run's canvas — press Run and
// look there, not at the Calls view, which is where you go when the answer is
// wrong.

import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";

const { items: shows } = await TheKajaTheatre.ListShows({});

kaja.text(`${shows.length} films screening this week.`);

const table = kaja.table(["id", "film", "director", "year", "runs", "starts", "from"]);
for (const show of shows) {
  table.row(
    show.id,
    show.title,
    show.director,
    show.year,
    `${show.runtimeMinutes} min`,
    new Date(show.startsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
    `€${(show.basePriceCents / 100).toFixed(2)}`,
  );
}
