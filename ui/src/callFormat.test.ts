import { describe, expect, it } from "bun:test";
import { barFraction, callErrorCode, formatDuration } from "./callFormat";
import { MethodCall } from "./kaja";

function failed(error: unknown): MethodCall {
  return { error } as MethodCall;
}

describe("barFraction", () => {
  it("draws each call against the slowest one in its run", () => {
    expect(barFraction(690, 690)).toBe(1);
    expect(barFraction(345, 690)).toBe(0.5);
  });

  // A column that is empty for the fast calls reads as missing data rather than
  // as a measurement, so the shortest bar is still a bar.
  it("leaves a visible sliver for a call too fast to draw", () => {
    expect(barFraction(1, 100_000)).toBe(0.04);
  });

  it("has no length to draw for a call still in flight", () => {
    expect(barFraction(undefined, 690)).toBeUndefined();
  });

  it("draws nothing in a run with nothing to compare against", () => {
    expect(barFraction(120, undefined)).toBeUndefined();
  });
});

describe("callErrorCode", () => {
  // A call against an HTTP app failed with a 404, not with NOT_FOUND — the gRPC
  // code is the tunnel, not the failure.
  it("labels an upstream failure by its HTTP status", () => {
    expect(callErrorCode(failed({ status: 409, code: "ALREADY_EXISTS" }))).toBe("409");
  });

  it("labels a genuine gRPC failure by its status code", () => {
    expect(callErrorCode(failed({ code: "UNAUTHENTICATED" }))).toBe("UNAUTHENTICATED");
  });

  it("has no label for a failure that carries neither", () => {
    expect(callErrorCode(failed({ message: "boom" }))).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("stays in milliseconds under a second", () => {
    expect(formatDuration(210)).toBe("210 ms");
  });

  it("loses a decimal place once the numbers get long", () => {
    expect(formatDuration(1200)).toBe("1.20 s");
    expect(formatDuration(161_000)).toBe("161.0 s");
  });
});
