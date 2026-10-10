import { kaja } from "kaja";
import { Theatre } from "theatre/service";

const vus = Math.round(number(kaja.input.vus, 6));
const seconds = number(kaja.input.seconds, 12);
const budgetMs = number(kaja.input.budgetMs, 400);

const { movies } = await Theatre.ListMovies({ ids: [], genre: "", limit: 100, cursor: "" });
const genres = [...new Set(movies.map((movie) => movie.genre))].filter(Boolean).sort();

const report = await kaja.perfTest(
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
