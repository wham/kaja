import { describe, expect, it } from "bun:test";
import { Block, RateLimitBlock } from "./blocks";
import { Kaja, MethodCall } from "./kaja";
import { APP_OF } from "./rateLimit";

// A Kaja whose canvas is a map, which is the whole of what a block has to reach.
function run() {
  const blocks = new Map<string, Block>();
  const kaja = new Kaja({
    onMethodCallUpdate: () => {},
    onAsk: () => Promise.reject(new Error("not asked")),
    onApprove: () => Promise.reject(new Error("not approved")),
    onBlockUpdate: (blockId, block) => void blocks.set(blockId, block),
    onLog: () => {},
  });
  const limits = (): RateLimitBlock[] => [...blocks.values()].filter((block): block is RateLimitBlock => block.kind === "limit");
  return { kaja, limits, blocks };
}

// A service as a script meets one: methods, plus the symbol saying which app they
// reach. Nothing else about it is what kaja.rateLimit reads.
function service(app: string): object {
  return Object.defineProperty({ ListShows: () => undefined }, APP_OF, { get: () => app });
}

// A settled call, as the run reports one.
function answered(app: string, headers: { [name: string]: string }, error?: unknown): MethodCall {
  return {
    id: crypto.randomUUID(),
    appName: app,
    service: { name: "Shows", packageName: "", sourcePath: "", clientStubModuleId: "", methods: [] },
    method: { name: "ListShows" },
    input: {},
    output: error === undefined ? {} : undefined,
    error,
    upstreamResponseHeaders: headers,
    timestamp: 0,
  };
}

describe("kaja.rateLimit", () => {
  it("does nothing at all until it is called", async () => {
    const { kaja, limits } = run();
    // The default is no rate limit, so an app nobody asked about waits for nothing and
    // draws nothing.
    expect(limits()).toEqual([]);
    await kaja._internal.acquireRateLimit("theatre");
    kaja._internal.methodCallUpdate(answered("theatre", { "x-rate-limit-remaining": "0", "x-rate-limit-reset": "600" }));
    expect(limits()).toEqual([]);
  });

  it("draws a block for the app the service belongs to", () => {
    const { kaja, limits } = run();
    kaja.rateLimit(service("theatre"));
    expect(limits()).toHaveLength(1);
    expect(limits()[0].app).toBe("theatre");
    expect(limits()[0].state).toBe("clear");
    expect(limits()[0].calls).toBe(0);
  });

  it("refuses anything that names neither an app nor a host", () => {
    const { kaja } = run();
    expect(() => kaja.rateLimit({})).toThrow(/expects a service imported from an app/);
    expect(() => kaja.rateLimit("  ")).toThrow(/expects a service imported from an app/);
  });

  it("takes a host, which is what a fetch has instead of an app", () => {
    const { kaja, limits } = run();
    // The same budget however it is named: what answers the calls is the host.
    const first = kaja.rateLimit("https://api.example.com/v3");
    const second = kaja.rateLimit("api.example.com");
    expect(second).toBe(first);
    expect(limits()).toHaveLength(1);
    expect(limits()[0].app).toBe("api.example.com");
  });

  it("keeps one limiter per app and restates its options", () => {
    const { kaja, limits } = run();
    const first = kaja.rateLimit(service("theatre"));
    const second = kaja.rateLimit(service("theatre"), { perSecond: 5 });
    // One budget, so one limiter and one block.
    expect(second).toBe(first);
    expect(limits()).toHaveLength(1);
    expect(limits()[0].declared).toBe("5/s");
  });

  it("learns the budget from what a call was answered with", () => {
    const { kaja, limits } = run();
    const limit = kaja.rateLimit(service("theatre"));
    kaja._internal.methodCallUpdate(answered("theatre", { "x-rate-limit-limit": "60", "x-rate-limit-remaining": "42", "x-rate-limit-reset": "6" }));

    expect(limit.limit).toBe(60);
    expect(limit.remaining).toBe(42);
    expect(limits()[0].remaining).toBe(42);
    expect(limits()[0].limit).toBe(60);
  });

  it("goes held on a refusal and says so on the block", () => {
    const { kaja, limits } = run();
    const limit = kaja.rateLimit(service("theatre"));
    kaja._internal.methodCallUpdate(answered("theatre", { "retry-after": "30" }, { message: "slow down", status: 429 }));

    expect(limit.state).toBe("held");
    expect(limit.refusals).toBe(1);
    expect(limits()[0].state).toBe("held");
    expect(limits()[0].refusals).toBe(1);
  });

  it("leaves another app's calls alone", () => {
    const { kaja } = run();
    const limit = kaja.rateLimit(service("theatre"));
    kaja._internal.methodCallUpdate(answered("grpcb.in", { "x-rate-limit-limit": "10", "x-rate-limit-remaining": "0", "x-rate-limit-reset": "60" }));
    // A budget belongs to the API it was read from, and this one was read from another.
    expect(limit.state).toBe("clear");
    expect(limit.limit).toBeUndefined();
  });

  it("does not count a call that is still in flight as answered", () => {
    const { kaja } = run();
    const limit = kaja.rateLimit(service("theatre"));
    const inFlight: MethodCall = { ...answered("theatre", { "x-rate-limit-remaining": "5" }), output: undefined };
    kaja._internal.methodCallUpdate(inFlight);
    // Its headers are not here yet, whatever the object happens to carry.
    expect(limit.remaining).toBeUndefined();
  });

  it("reports a call waiting on a budget as work the run still has", async () => {
    const { kaja } = run();
    kaja.rateLimit(service("theatre"));
    expect(kaja._internal.hasCallsWaiting()).toBe(false);

    // The signal is read when a call asks for its permit, which in a run is always
    // after runScript has set it.
    const controller = new AbortController();
    kaja._internal.abortSignal = controller.signal;

    kaja._internal.methodCallUpdate(answered("theatre", { "x-rate-limit-remaining": "0", "x-rate-limit-reset": "30" }));
    const held = kaja._internal.acquireRateLimit("theatre");
    await Promise.resolve();
    // No row is written for a held call, so this is the only way the run knows it is
    // not finished — without it an unawaited call would end its run and land in none.
    expect(kaja._internal.hasCallsWaiting()).toBe(true);

    // And Stop reaches it: a run being aborted stops waiting on a clock.
    controller.abort();
    await held;
    expect(kaja._internal.hasCallsWaiting()).toBe(false);
  });

  it("reads live, so the handle can be taken before the run and read after it", async () => {
    const { kaja } = run();
    const limit = kaja.rateLimit(service("theatre"), { perSecond: 1000 });
    expect(limit.calls).toBe(0);
    await kaja._internal.acquireRateLimit("theatre");
    await kaja._internal.acquireRateLimit("theatre");
    expect(limit.calls).toBe(2);
  });
});
