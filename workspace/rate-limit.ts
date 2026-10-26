import { kaja } from "kaja";
import { RateLimit } from "github";

const overview = await RateLimit.Get({});

kaja.table(
  Object.entries(overview.resources ?? {}).filter(([, budget]) => budget && budget.limit > 0),
  ([resource, budget]) => ({
    resource,
    remaining: budget!.remaining,
    of: budget!.limit,
    resets: new Date(budget!.reset * 1000).toISOString(),
  }),
  { title: "What is left of this hour's GitHub budget" },
);
