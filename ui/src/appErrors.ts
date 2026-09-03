/**
 * The errors Kaja itself hit, as the footer states them.
 *
 * The line this draws is scope, exactly as `scriptConsole` draws it: what a script
 * printed belongs to that run's console, and what Kaja could not do belongs here. A
 * script's console forwards to `deviceConsole`, the console as it was before
 * `installUiLog` patched it, so a script's `console.error` can never reach this store
 * — there is nothing to filter and no origin to tag.
 *
 * The rule the other way round is the one worth stating: **a failure that already has
 * a place is written to `deviceConsole`; a failure with nowhere else to go goes
 * through the patched console and lands here.** A compilation that failed is on the
 * app's row in the compile status, and a script that threw is a row in its own run, so
 * neither is repeated in the footer. A write to IndexedDB that was refused has nowhere
 * else at all, which is what this exists for.
 *
 * Errors only. A warning is something Kaja carried on past, and a footer item that
 * counted them would be lit in a session where nothing went wrong.
 */

// The ring is what a bug report is written from, not a log to read through: the
// popover draws a handful and the rest is depth for a copy.
const MAX_ENTRIES = 50;

export interface AppError {
  // The whole of what was reported, headline and stack together, exactly as it would
  // be written to kaja.log. The popover splits the first line off; the copy takes it
  // whole.
  message: string;
  // Last time it was reported, which is what the row states — a repeat is news about
  // now, not about the first time it happened.
  at: number;
  // How many times this exact message has been reported in a row. A render loop
  // throwing the same error two hundred times has to be one row saying so, or the
  // count in the footer is a lie about how much is wrong.
  count: number;
}

let entries: readonly AppError[] = [];
const listeners = new Set<() => void>();
let frame = false;

let schedule: (run: () => void) => void = (run) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
};

// Overridable so tests can run the queue without a frame.
export function setAppErrorSchedule(next: (run: () => void) => void): void {
  schedule = next;
}

/**
 * Report a failure.
 *
 * Called from the patched console and from the window's own error events, so it runs
 * inside `console.error` itself: it must never throw and must never log, or an error
 * becomes a loop. Nothing in here can do either.
 */
export function recordAppError(message: string, at: number = Date.now()): void {
  const newest = entries[0];
  if (newest && newest.message === message) {
    entries = [{ message, at, count: newest.count + 1 }, ...entries.slice(1)];
  } else {
    entries = [{ message, at, count: 1 }, ...entries.slice(0, MAX_ENTRIES - 1)];
  }
  notify();
}

export function clearAppErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  notify();
}

/**
 * The snapshot `useSyncExternalStore` reads. The same array comes back until something
 * is recorded, which is what keeps React from re-rendering the footer on every read.
 */
export function getAppErrors(): readonly AppError[] {
  return entries;
}

export function subscribeAppErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Coalesced to the frame for the reason the console store's is: an error storm arrives
// as fast as the loop throwing it, and a repaint per error is the window locking up on
// its own report of what went wrong.
function notify(): void {
  if (frame) return;
  frame = true;
  schedule(() => {
    frame = false;
    for (const listener of listeners) listener();
  });
}
