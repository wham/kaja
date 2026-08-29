import { describe, expect, it } from "bun:test";
import { RateLimiter, readBudget, readRetryAfter, resetMoment } from "./rateLimit";

// A clock and a sleep the test drives, so a limiter that waits minutes is instant here
// and every wait is exact rather than approximately observed.
function fakeClock(startedAt = 1_700_000_000_000) {
  let now = startedAt;
  return {
    now: () => now,
    advance: (ms: number) => (now += ms),
    // Sleeping is what moves this clock, which is what makes the waits assertable.
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

function limiter(options = {}, clock = fakeClock()) {
  let draws = 0;
  const it = new RateLimiter("theatre", options, { onChange: () => draws++, now: clock.now, sleep: clock.sleep });
  return { limiter: it, clock, draws: () => draws };
}

describe("resetMoment", () => {
  it("reads a small value as seconds from now", () => {
    expect(resetMoment(6, 1_000_000)).toBe(1_000_000 + 6_000);
    expect(resetMoment(0, 1_000_000)).toBe(1_000_000);
  });

  it("reads an epoch second as the moment it names", () => {
    // 10^9 seconds is 2001, and no window is 31 years long, which is the whole of the rule.
    expect(resetMoment(1_700_000_060, 1_700_000_000_000)).toBe(1_700_000_060_000);
  });

  it("reads an epoch millisecond as itself", () => {
    expect(resetMoment(1_700_000_060_000, 1_700_000_000_000)).toBe(1_700_000_060_000);
  });
});

describe("readBudget", () => {
  it("reads the hyphenated X-Rate-Limit spelling", () => {
    const budget = readBudget({ "x-rate-limit-limit": "60", "x-rate-limit-remaining": "0", "x-rate-limit-reset": "6" }, 1_000_000);
    expect(budget).toEqual({ limit: 60, remaining: 0, resetAt: 1_006_000 });
  });

  it("reads the X-RateLimit and bare RateLimit spellings the same way", () => {
    expect(readBudget({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "7" }, 0)).toEqual({ limit: 100, remaining: 7, resetAt: undefined });
    expect(readBudget({ "ratelimit-limit": "100", "ratelimit-remaining": "7" }, 0)).toEqual({ limit: 100, remaining: 7, resetAt: undefined });
  });

  it("reads the structured field", () => {
    expect(readBudget({ ratelimit: "limit=100, remaining=50, reset=60" }, 1_000_000)).toEqual({ limit: 100, remaining: 50, resetAt: 1_060_000 });
  });

  it("reads reset-after as a delay whatever its size", () => {
    // Named a delay, so the epoch rule must not claim it.
    const budget = readBudget({ "x-ratelimit-reset-after": "1700000060" }, 1_000);
    expect(budget?.resetAt).toBe(1_000 + 1_700_000_060_000);
  });

  it("says nothing when the response said nothing", () => {
    expect(readBudget({ "content-type": "application/json" }, 0)).toBeUndefined();
  });
});

describe("readRetryAfter", () => {
  it("reads seconds", () => {
    expect(readRetryAfter("30", 1_000)).toBe(31_000);
  });

  it("reads an HTTP-date", () => {
    expect(readRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", 0)).toBe(Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"));
  });

  it("ignores what it cannot read", () => {
    expect(readRetryAfter("soon", 0)).toBeUndefined();
    expect(readRetryAfter(undefined, 0)).toBeUndefined();
  });
});

describe("RateLimiter", () => {
  it("lets calls through untouched while there is headroom", async () => {
    const { limiter: it, clock } = limiter();
    const startedAt = clock.now();
    it.settle({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "90", "x-ratelimit-reset": "60" }, false);
    await it.acquire();
    expect(clock.now()).toBe(startedAt);
    expect(it.state).toBe("clear");
    expect(it.held).toBe(0);
  });

  it("holds until the window turns over when the budget is spent", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({ "x-rate-limit-limit": "60", "x-rate-limit-remaining": "0", "x-rate-limit-reset": "6" }, false);
    expect(it.state).toBe("held");

    await it.acquire();

    // The six seconds the API named, waited out rather than spent being refused.
    expect(clock.now()).toBe(1_700_000_006_000);
    expect(it.held).toBe(1);
    expect(it.waitedMs).toBe(6_000);
    expect(it.calls).toBe(1);
  });

  it("spreads what is left over the time that is left once under the reserve", async () => {
    const { limiter: it, clock } = limiter();
    // 5 of 100 left and 60 seconds to go: one every twelve seconds.
    it.settle({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "5", "x-ratelimit-reset": "60" }, false);
    expect(it.state).toBe("pacing");

    const first = clock.now();
    await it.acquire();
    // The first call is not made to wait — nothing has been issued for it to be spaced from.
    expect(clock.now()).toBe(first);
    await it.acquire();
    expect(clock.now() - first).toBe(12_000);
  });

  it("never waits when the script is slower than the pace", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "5", "x-ratelimit-reset": "60" }, false);
    await it.acquire();
    clock.advance(30_000);
    const before = clock.now();
    await it.acquire();
    expect(clock.now()).toBe(before);
    // Pacing is an interval since the last call, so a script already slower than it
    // pays nothing: neither of these waited.
    expect(it.held).toBe(0);
  });

  it("holds after a refusal even when the headers still claim a budget", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "9", "retry-after": "30" }, true);
    expect(it.state).toBe("held");
    expect(it.refusals).toBe(1);

    const startedAt = clock.now();
    await it.acquire();
    expect(clock.now() - startedAt).toBe(30_000);
  });

  it("holds for a fixed spell when a refusal named no reset", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({}, true);
    const startedAt = clock.now();
    await it.acquire();
    expect(clock.now() - startedAt).toBe(5_000);
  });

  it("keeps a declared ceiling even where the API publishes nothing", async () => {
    const { limiter: it, clock } = limiter({ perSecond: 10 });
    const startedAt = clock.now();
    await it.acquire();
    await it.acquire();
    await it.acquire();
    expect(clock.now() - startedAt).toBe(200);
    expect(it.declared).toBe("10/s");
  });

  it("takes the tighter of a declared ceiling and what the API says", async () => {
    const { limiter: it, clock } = limiter({ perSecond: 10 });
    // Pacing wants one every twelve seconds, which is far tighter than 10/s.
    it.settle({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "5", "x-ratelimit-reset": "60" }, false);
    await it.acquire();
    const before = clock.now();
    await it.acquire();
    expect(clock.now() - before).toBe(12_000);
  });

  it("gives up waiting at maxWait and lets the call go to be refused", async () => {
    const { limiter: it, clock } = limiter({ maxWait: "2s" });
    it.settle({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3600" }, false);
    const startedAt = clock.now();
    await it.acquire();
    // An hour is not waited out silently; the call goes and the API answers for it.
    expect(clock.now() - startedAt).toBe(2_000);
  });

  it("stops waiting when the run is aborted", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "600" }, false);
    const controller = new AbortController();
    controller.abort();
    const startedAt = clock.now();
    await it.acquire(controller.signal);
    expect(clock.now()).toBe(startedAt);
  });

  it("counts calls in flight against what is left", async () => {
    const { limiter: it } = limiter();
    it.settle({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "2", "x-ratelimit-reset": "60" }, false);
    await it.acquire();
    await it.acquire();
    // Both are on the wire and the API's count has not caught up, so nothing is left.
    expect(it.remaining).toBe(0);
    expect(it.state).toBe("held");
  });

  it("goes clear again once the window it was told about has passed", async () => {
    const { limiter: it, clock } = limiter();
    it.settle({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "6" }, false);
    expect(it.state).toBe("held");
    clock.advance(6_001);
    // A window whose reset has passed says nothing about the one we are in now.
    expect(it.state).toBe("clear");
    expect(it.resetInMs).toBeUndefined();
  });

  it("serialises admission so concurrent callers are paced rather than let through together", async () => {
    const { limiter: it, clock } = limiter({ perSecond: 4 });
    const startedAt = clock.now();
    await Promise.all([it.acquire(), it.acquire(), it.acquire()]);
    expect(clock.now() - startedAt).toBe(500);
    expect(it.calls).toBe(3);
  });
});
