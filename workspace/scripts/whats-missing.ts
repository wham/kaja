// What the shelf cannot cover this morning, one row per cookie.
//
// The row is declared before the work that fills it and rewritten when the
// answers come back, so the table draws itself as the loop runs rather than
// appearing all at once at the end. That is what kaja.table's handles are for.

import { kaja } from "kaja";
import { Bakebook } from "bakebook/service";
import { Tools } from "kitchen/mcp";

const { items: cookies } = await Bakebook.ListCookies({});

const table = kaja.table(["cookie", "one tray", "dough", "missing", "use instead"]);

for (const cookie of cookies) {
  const tray = `${cookie.perTray} cookies`;
  const row = table.row(cookie.name, tray, "…", "…", "…");

  const { structuredContent: plan } = await Tools.Scale({ cookieId: cookie.id, cookies: cookie.perTray });
  if (!plan) {
    row.update(cookie.name, tray, "—", "the kitchen did not answer", "—");
    continue;
  }
  if (plan.missing.length === 0) {
    row.update(cookie.name, tray, `${plan.doughGrams} g`, "—", "—");
    continue;
  }

  // Only the cookies that need an answer cost a second call.
  const { structuredContent: swap } = await Tools.Substitute({ ingredient: plan.missing[0], why: "out of stock" });
  row.update(cookie.name, tray, `${plan.doughGrams} g`, plan.missing.join(", "), swap ? swap.use : "—");
}

kaja.text("Every gap above has an answer; ask the kitchen why it costs what it costs.");
