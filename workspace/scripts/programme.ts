// This week's programme, drawn as a table.
//
// The shortest thing a script can be: one call, one table. Everything a script
// has to say it draws on the run's canvas — press Run and look there rather than
// at the Calls view, which is where you go when the answer is wrong.

import { kaja } from "kaja";
import { TheKajaTheatre } from "theatre/service";

const { items: shows } = await TheKajaTheatre.ListShows({});

kaja.text(`${shows.length} shows playing this week.`);

const table = kaja.table(["id", "title", "genre", "curtain-up", "from"]);
for (const show of shows) {
  table.row(
    show.id,
    show.title,
    show.genre,
    new Date(show.startsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
    `€${(show.basePriceCents / 100).toFixed(2)}`,
  );
}
