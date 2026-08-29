import { Duration, parseDuration } from "./perfTest";

/**
 * The client half of a rate limit: what an API says about its budget on every
 * response, and what to do about it.
 *
 * Nothing here runs until a script asks for it. `kaja.rateLimit(Shows)` builds one of
 * these for the app behind that service; every other app, and every run that never
 * asks, is untouched.
 *
 * The states are three because the mechanism has three, which is why the block draws
 * as a signal: spend freely while there is headroom, spread what is left once there
 * isn't, and hold when there is none.
 */
export type RateLimitState = "clear" | "pacing" | "held";

export interface RateLimitOptions {
  /** A ceiling of the script's own, for an API that publishes no headers to read. */
  perSecond?: number;
  /** The share of the budget below which what is left is spread rather than spent. */
  reserve?: number;
  /** The longest one call is held before it is let go to be refused. */
  maxWait?: Duration;
}

/** What an API last said about the budget. Every field is absent until one says it. */
export interface Budget {
  limit?: number;
  remaining?: number;
  /** Epoch milliseconds, whichever way the API spelled it. */
  resetAt?: number;
}

type Headers = { [name: string]: string };

const DEFAULT_RESERVE = 0.2;
const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

// A reset of 10^9 or more is a moment rather than a delay: 10^9 seconds is 2001, and
// no rate limit window is 31 years long. 10^12 is the same line drawn in milliseconds.
const EPOCH_SECONDS = 1e9;
const EPOCH_MILLIS = 1e12;

// How long to hold after a refusal that named no reset of its own. The API said stop
// and nothing said for how long, so this is the one number here invented rather than
// read off a response.
const BLIND_HOLD_MS = 5_000;

// How often a waiting call redraws the block. The countdown only has to move while
// something is actually waiting on it, so the wait is the beat and there is no timer
// left running behind a run that has finished.
const DRAW_MS = 250;

// The three spellings compete but mean one thing, so they are read as one. Only
// Retry-After is standardised (RFC 9110), and it arrives once you are already refused.
const LIMIT_NAMES = ["ratelimit-limit", "x-ratelimit-limit", "x-rate-limit-limit"];
const REMAINING_NAMES = ["ratelimit-remaining", "x-ratelimit-remaining", "x-rate-limit-remaining"];
const RESET_NAMES = ["ratelimit-reset", "x-ratelimit-reset", "x-rate-limit-reset"];
// Named a delay, so it is one whatever its size — the epoch rule below never applies.
const RESET_AFTER_NAMES = ["ratelimit-reset-after", "x-ratelimit-reset-after", "x-rate-limit-reset-after"];

/**
 * The symbol carrying which app a service's methods belong to. A script names an app
 * by importing a service from it, so this is what turns `kaja.rateLimit(Shows)` into a
 * budget without a stringly-typed app name. A symbol because `Methods` is a string
 * index signature of methods, and an ordinary key would read as one.
 */
export const APP_OF = Symbol("kaja.app");

/** Which moment a `reset` value names. Absolute when it is too large to be a delay. */
export function resetMoment(value: number, now: number): number {
  if (value >= EPOCH_MILLIS) return value;
  if (value >= EPOCH_SECONDS) return value * 1000;
  return now + value * 1000;
}

/** Retry-After, which is seconds or an HTTP-date and outranks anything derived. */
export function readRetryAfter(value: string | undefined, now: number): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return now + Math.max(0, seconds) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
}

/**
 * What a response said about the budget, or undefined when it said nothing. Header
 * names are already lowercased by the time a call reports them.
 */
export function readBudget(headers: Headers, now: number): Budget | undefined {
  const structured = readStructured(headers["ratelimit"]);
  const limit = firstNumber(headers, LIMIT_NAMES) ?? structured?.limit;
  const remaining = firstNumber(headers, REMAINING_NAMES) ?? structured?.remaining;

  const after = firstNumber(headers, RESET_AFTER_NAMES);
  const reset = firstNumber(headers, RESET_NAMES) ?? structured?.reset;
  let resetAt: number | undefined;
  if (after !== undefined) resetAt = now + after * 1000;
  else if (reset !== undefined) resetAt = resetMoment(reset, now);

  if (limit === undefined && remaining === undefined && resetAt === undefined) return undefined;
  return { limit, remaining, resetAt };
}

// The three as they are written, before `reset` is resolved to a moment.
interface RawBudget {
  limit?: number;
  remaining?: number;
  reset?: number;
}

// The newer draft carries the same three as one structured field:
// `RateLimit: limit=100, remaining=50, reset=60`, and some servers separate with ";".
function readStructured(value: string | undefined): RawBudget | undefined {
  if (value === undefined) return undefined;
  const read: RawBudget = {};
  for (const part of value.split(/[,;]/)) {
    const [rawKey, rawValue] = part.split("=");
    if (rawValue === undefined) continue;
    const key = rawKey.trim().toLowerCase();
    const parsed = Number(rawValue.trim().replace(/^"|"$/g, ""));
    if (!Number.isFinite(parsed)) continue;
    if (key === "limit" || key === "l") read.limit = parsed;
    else if (key === "remaining" || key === "r") read.remaining = parsed;
    else if (key === "reset" || key === "t") read.reset = parsed;
  }
  return read.limit === undefined && read.remaining === undefined && read.reset === undefined ? undefined : read;
}

function firstNumber(headers: Headers, names: string[]): number | undefined {
  for (const name of names) {
    const value = headers[name];
    if (value === undefined) continue;
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export interface RateLimiterHooks {
  onChange: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One app's budget, and the queue in front of it.
 *
 * Admission is serialised — one call is let through at a time — because the interval
 * between two calls is what pacing is, and two waiters reading the same "last issued"
 * would both think their turn had come. The calls themselves stay concurrent: what is
 * serialised is being let go, not running.
 */
export class RateLimiter {
  readonly app: string;
  calls = 0;
  held = 0;
  waitedMs = 0;
  refusals = 0;
  waiting = 0;

  #reserve = DEFAULT_RESERVE;
  #maxWaitMs = DEFAULT_MAX_WAIT_MS;
  #minIntervalMs = 0;
  #declared?: string;
  #budget: Budget = {};
  // Admitted and not yet answered. The API's `remaining` counts what it has seen, so
  // what is actually left is that minus what is on the wire.
  #inFlight = 0;
  #lastIssuedAt = 0;
  #gate: Promise<void> = Promise.resolve();
  #onChange: () => void;
  #now: () => number;
  #sleep: (ms: number) => Promise<void>;

  // Nothing here may notify: the caller's onChange closes over the limiter being
  // constructed, so a draw from inside the constructor reaches it in its dead zone.
  constructor(app: string, options: RateLimitOptions, hooks: RateLimiterHooks) {
    this.app = app;
    this.#onChange = hooks.onChange;
    this.#now = hooks.now ?? Date.now;
    this.#sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.configure(options);
  }

  configure(options: RateLimitOptions): void {
    if (options.perSecond !== undefined) {
      if (!Number.isFinite(options.perSecond) || options.perSecond <= 0) {
        throw new Error(`kaja.rateLimit: perSecond must be a positive number of calls, got ${options.perSecond}.`);
      }
      this.#minIntervalMs = 1000 / options.perSecond;
      this.#declared = `${options.perSecond}/s`;
    }
    if (options.reserve !== undefined) {
      if (!Number.isFinite(options.reserve) || options.reserve < 0 || options.reserve > 1) {
        throw new Error(`kaja.rateLimit: reserve is a share of the budget between 0 and 1, got ${options.reserve}.`);
      }
      this.#reserve = options.reserve;
    }
    if (options.maxWait !== undefined) {
      this.#maxWaitMs = parseDuration(options.maxWait, "maxWait", "kaja.rateLimit");
    }
  }

  get budget(): Budget {
    return this.#budget;
  }

  get declared(): string | undefined {
    return this.#declared;
  }

  /** What is left as far as this limiter knows: the API's last word, less what is in flight. */
  get remaining(): number | undefined {
    return this.#budget.remaining === undefined ? undefined : Math.max(0, this.#budget.remaining - this.#inFlight);
  }

  get state(): RateLimitState {
    return this.#stateAt(this.#now());
  }

  /** Milliseconds until the window turns over, while it is still ahead of us. */
  get resetInMs(): number | undefined {
    const { resetAt } = this.#budget;
    if (resetAt === undefined) return undefined;
    const left = resetAt - this.#now();
    return left > 0 ? left : undefined;
  }

  /**
   * Hold the caller until the budget allows another call. Resolves rather than throws
   * when it gives up: past `maxWait` the call goes out and is refused by the API, which
   * is a real error in the log rather than a run that never ends.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.#gate.then(() => this.#take(signal));
    // The queue is chained on a settled promise rather than on this one: a turn that
    // somehow rejects must not wedge every call behind it for the rest of the run.
    this.#gate = turn.then(
      () => {},
      () => {},
    );
    return turn;
  }

  async #take(signal?: AbortSignal): Promise<void> {
    const startedAt = this.#now();
    this.waiting++;
    this.#onChange();
    try {
      for (;;) {
        // Stop is about the run, not the budget: a run being aborted stops waiting and
        // lets its call go, where the transport's own abort finishes the job.
        if (signal?.aborted) break;
        const now = this.#now();
        const waited = now - startedAt;
        if (waited >= this.#maxWaitMs) break;
        const delay = this.#delayAt(now);
        if (delay <= 0) break;
        await this.#sleep(Math.min(delay, DRAW_MS, this.#maxWaitMs - waited));
        this.#onChange();
      }
    } finally {
      this.waiting--;
    }

    const waited = this.#now() - startedAt;
    this.calls++;
    if (waited >= 1) {
      this.held++;
      this.waitedMs += waited;
    }
    this.#inFlight++;
    this.#lastIssuedAt = this.#now();
    this.#onChange();
  }

  /**
   * What one answered call taught us. Called exactly once per call, when it stops being
   * in flight, so the in-flight count it corrects can't drift.
   */
  settle(headers: Headers, rateLimited: boolean): void {
    const now = this.#now();
    this.#inFlight = Math.max(0, this.#inFlight - 1);

    const read = readBudget(headers, now);
    // Merged rather than replaced: a response carrying only `remaining` still leaves the
    // limit it was a share of standing.
    if (read !== undefined) this.#budget = { ...this.#budget, ...read };

    const retryAt = readRetryAfter(headers["retry-after"], now);
    if (retryAt !== undefined) this.#budget = { ...this.#budget, resetAt: retryAt };

    if (rateLimited) {
      this.refusals++;
      // Refused is refused, whatever the headers claim is left.
      const resetAt = retryAt ?? read?.resetAt ?? this.#budget.resetAt;
      this.#budget = {
        ...this.#budget,
        remaining: 0,
        resetAt: resetAt !== undefined && resetAt > now ? resetAt : now + BLIND_HOLD_MS,
      };
    }
    this.#onChange();
  }

  #stateAt(now: number): RateLimitState {
    const { limit, remaining, resetAt } = this.#budget;
    // A window whose reset has passed says nothing about the one we are in now.
    if (resetAt === undefined || resetAt <= now) return "clear";
    const left = remaining === undefined ? undefined : Math.max(0, remaining - this.#inFlight);
    if (left !== undefined && left <= 0) return "held";
    if (limit !== undefined && limit > 0 && left !== undefined && left / limit <= this.#reserve) return "pacing";
    return "clear";
  }

  /**
   * How long this call has to wait. Being held is a wait for the window; pacing is an
   * interval since the last call let through, which is why a script slower than the
   * pace never waits at all.
   */
  #delayAt(now: number): number {
    const { limit, remaining, resetAt } = this.#budget;
    const window = resetAt !== undefined && resetAt > now ? resetAt - now : undefined;
    const left = remaining === undefined ? undefined : Math.max(0, remaining - this.#inFlight);

    if (window !== undefined && left !== undefined && left <= 0) return window;

    let interval = this.#minIntervalMs;
    if (window !== undefined && limit !== undefined && limit > 0 && left !== undefined && left > 0 && left / limit <= this.#reserve) {
      // Spend what is left over the time that is left, so the budget lands on the reset
      // instead of running out well before it.
      interval = Math.max(interval, window / left);
    }
    if (interval <= 0) return 0;
    return Math.max(0, this.#lastIssuedAt + interval - now);
  }
}
