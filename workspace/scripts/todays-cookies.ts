// Everything the bakery bakes, drawn as a table.
//
// The shortest thing a script can be: one call, one table. Everything a script
// has to say it draws on the run's canvas — press Run and look there rather than
// at the Calls view, which is where you go when the answer is wrong.

import { kaja } from "kaja";
import { Bakebook } from "bakebook/service";

const { items: cookies } = await Bakebook.ListCookies({});

kaja.text(`${cookies.length} cookies in the book. Copy an id — it is the only thing the oven and the kitchen need.`);

const table = kaja.table(["id", "cookie", "texture", "bake", "per tray", "each"]);
for (const cookie of cookies) {
  table.row(
    cookie.id,
    cookie.name,
    cookie.texture,
    `${cookie.bakeMinutes} min at ${cookie.ovenCelsius}°C`,
    cookie.perTray,
    `€${(cookie.priceCents / 100).toFixed(2)}`,
  );
}
