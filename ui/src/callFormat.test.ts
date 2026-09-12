import { describe, expect, it } from "bun:test";
import { barFraction, callErrorCode, exchangeStatus, formatDuration } from "./callFormat";
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

describe("exchangeStatus", () => {
  it("reads the status a call that succeeded was answered with", () => {
    expect(exchangeStatus({ responseStatus: 200, responseStatusText: "OK" } as MethodCall)).toEqual({ code: "200", reason: "OK", tone: "success" });
  });

  it("reads the status off a failure that carries its own", () => {
    expect(exchangeStatus(failed({ status: 401, statusText: "Unauthorized", request: "GET https://api.example.com/x" }))).toEqual({
      code: "401",
      reason: "Unauthorized",
      tone: "error",
    });
  });

  // The exchange answered, and the row above says the call failed. Showing the 200 it
  // arrived with is what makes the pane the report of the exchange rather than of the
  // call — it is also the whole explanation of an unreadable response.
  it("states the success a response kaja could not read arrived with", () => {
    expect(exchangeStatus(failed({ responseStatus: 200, responseStatusText: "OK", message: "not the shape the spec declares" }))).toEqual({
      code: "200",
      reason: "OK",
      tone: "success",
    });
  });

  it("reads a redirect as neither", () => {
    expect(exchangeStatus({ responseStatus: 302, responseStatusText: "Found" } as MethodCall)?.tone).toBe("redirect");
  });

  it("falls back on the gRPC status where there is no status line to read", () => {
    expect(exchangeStatus(failed({ code: "UNAUTHENTICATED" }))).toEqual({ code: "UNAUTHENTICATED", tone: "error" });
  });

  it("has nothing to state for a call through an app that speaks no HTTP", () => {
    expect(exchangeStatus({} as MethodCall)).toBeUndefined();
  });

  it("leaves out a reason phrase the status has none of", () => {
    expect(exchangeStatus({ responseStatus: 204, responseStatusText: "" } as MethodCall)).toEqual({ code: "204", reason: undefined, tone: "success" });
  });
});
