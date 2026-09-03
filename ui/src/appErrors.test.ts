import { beforeEach, describe, expect, it } from "bun:test";
import { clearAppErrors, getAppErrors, recordAppError, setAppErrorSchedule, subscribeAppErrors } from "./appErrors";

const NOW = 1_700_000_000_000;

// The store notifies on the frame; tests run the queue by hand so a report and what it
// does to the list are one step. The store is a singleton, like the console it is filled
// from, so the queue is drained rather than replaced — a callback left pending would
// otherwise hold the coalescing flag down for every test after it.
const frames: (() => void)[] = [];

function paint(): void {
  while (frames.length > 0) frames.shift()!();
}

beforeEach(() => {
  setAppErrorSchedule((run) => frames.push(run));
  paint();
  clearAppErrors();
  paint();
});

describe("recordAppError", () => {
  it("keeps the newest first", () => {
    recordAppError("first", NOW);
    recordAppError("second", NOW + 1);

    expect(getAppErrors().map((error) => error.message)).toEqual(["second", "first"]);
  });

  it("collapses a repeat into one row that counts and carries the latest time", () => {
    recordAppError("boom", NOW);
    recordAppError("boom", NOW + 10);
    recordAppError("boom", NOW + 20);

    expect(getAppErrors()).toEqual([{ message: "boom", at: NOW + 20, count: 3 }]);
  });

  it("only collapses against the newest, so an interleaved error keeps its own row", () => {
    recordAppError("boom", NOW);
    recordAppError("other", NOW + 1);
    recordAppError("boom", NOW + 2);

    expect(getAppErrors().map((error) => [error.message, error.count])).toEqual([
      ["boom", 1],
      ["other", 1],
      ["boom", 1],
    ]);
  });

  it("caps the ring, dropping the oldest", () => {
    for (let i = 0; i < 60; i++) recordAppError(`error ${i}`, NOW + i);

    const errors = getAppErrors();
    expect(errors).toHaveLength(50);
    expect(errors[0].message).toBe("error 59");
    expect(errors[49].message).toBe("error 10");
  });

  it("hands back the same snapshot until something is reported", () => {
    recordAppError("boom", NOW);
    const snapshot = getAppErrors();

    expect(getAppErrors()).toBe(snapshot);

    recordAppError("boom", NOW + 1);
    expect(getAppErrors()).not.toBe(snapshot);
  });
});

describe("notification", () => {
  it("coalesces a burst into one notification", () => {
    let notifications = 0;
    const unsubscribe = subscribeAppErrors(() => notifications++);

    for (let i = 0; i < 200; i++) recordAppError("boom", NOW + i);
    expect(notifications).toBe(0);

    paint();
    expect(notifications).toBe(1);

    unsubscribe();
  });

  it("stops notifying once unsubscribed", () => {
    let notifications = 0;
    subscribeAppErrors(() => notifications++)();

    recordAppError("boom", NOW);
    paint();

    expect(notifications).toBe(0);
  });
});

describe("clearAppErrors", () => {
  it("empties the ring and notifies", () => {
    let notifications = 0;
    const unsubscribe = subscribeAppErrors(() => notifications++);
    recordAppError("boom", NOW);
    paint();

    clearAppErrors();
    paint();

    expect(getAppErrors()).toEqual([]);
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it("says nothing when there was nothing to clear", () => {
    let notifications = 0;
    const unsubscribe = subscribeAppErrors(() => notifications++);

    clearAppErrors();
    paint();

    expect(notifications).toBe(0);
    unsubscribe();
  });
});
