// How fast is the catalog, and does it stay that way as the load comes on.
//
// Every run has a Stats tab. This is what it looks like when the run was
// *shaped* for it: kaja.perfTest holds a body at a set number of virtual
// users, and the phases it walks through — warm-up, ramp-up, steady,
// ramp-down — are drawn as bands across all three charts.
//
// Three things are worth looking at while it runs:
//
//   in flight      the schedule itself. It climbs to the plateau over the
//                  ramp-up and drains at the end, which is the one chart
//                  that shows what the test was told to do.
//   latency        the p50 line with the p50–p95 and p95–p99 bands behind
//                  it. If the API bends under load, it bends here first.
//   distribution   where the calls actually landed. A percentile table
//                  cannot show you two humps; this can.
//
// The warm-up is measured and then left out of the percentiles — the tile
// strip says so rather than quietly dropping it. Failed calls leave the
// latency for the same reason and are counted everywhere else.
//
// The defaults are deliberately small: this points at a public demo service,
// not at something of yours. Pass vus and seconds to change them, either from
// Run with parameters or from a deeplink.

import { kaja } from "kaja";
import { Theatre } from "theatre/service";

const vus = Math.round(number(kaja.input.vus, 6));
const seconds = number(kaja.input.seconds, 12);
// What the run is judged against, which is the whole reason perfTest hands a
// report back rather than only drawing one.
const budgetMs = number(kaja.input.budgetMs, 400);

// Setup belongs before the test: asks and approvals throw inside the body,
// because ten virtual users parked on one question is a deadlock wearing a
// dialog. This call is also why the time axis has a stretch before the bands.
const { movies } = await Theatre.ListMovies({ ids: [], genre: "", limit: 100, cursor: "" });
const genres = [...new Set(movies.map((movie) => movie.genre))].filter(Boolean).sort();

const report = await kaja.perfTest(
  // One iteration is one read of the catalog. The genre rotates so the test
  // is not asking for the same answer a thousand times over.
  ({ iteration }) => Theatre.ListMovies({ ids: [], genre: genres[iteration % genres.length] ?? "", limit: 25, cursor: "" }),
  { duration: `${seconds}s`, concurrency: vus, warmup: "2s", rampUp: "4s", rampDown: "2s" },
);

const p99 = Math.round(report.latency.p99 ?? 0);
kaja.text(
  p99 <= budgetMs
    ? `p99 ${p99} ms, inside the ${budgetMs} ms budget — over ${report.requests.toLocaleString()} requests at ${vus} users.`
    : `p99 ${p99} ms, over the ${budgetMs} ms budget — ${report.requests.toLocaleString()} requests at ${vus} users.`,
);

function number(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
