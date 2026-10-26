import { kaja } from "kaja";
import { HelloService } from "grpcb.in";

const budgetMs = Number(kaja.input.budgetMs) || 500;

const report = await kaja.perfTest(({ iteration }) => HelloService.SayHello({ greeting: `call ${iteration}` }), {
  iterations: 200,
  concurrency: 4,
  warmup: 10,
});

const p99 = Math.round(report.latency.p99 ?? 0);
kaja.text(
  p99 <= budgetMs
    ? `p99 ${p99} ms, inside the ${budgetMs} ms budget, over ${report.requests} calls to grpcb.in.`
    : `p99 ${p99} ms, over the ${budgetMs} ms budget, across ${report.requests} calls to grpcb.in.`,
);
