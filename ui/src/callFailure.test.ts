import { describe, expect, it } from "bun:test";
import { classifyFailure } from "./callFailure";

describe("classifyFailure", () => {
  it("reads an upstream HTTP failure by its status", () => {
    expect(classifyFailure({ message: "missing pageSize", status: 400 })).toEqual({
      kind: "INVALID_REQUEST",
      message: "missing pageSize",
      status: 400,
      code: undefined,
    });
    expect(classifyFailure({ message: "nope", status: 401 }).kind).toBe("UNAUTHORIZED");
    expect(classifyFailure({ message: "gone", status: 404 }).kind).toBe("NOT_FOUND");
    expect(classifyFailure({ message: "slow down", status: 429 }).kind).toBe("RATE_LIMITED");
    expect(classifyFailure({ message: "boom", status: 503 }).kind).toBe("SERVER");
  });

  it("reads Kaja's own refusal ahead of anything a server could have said", () => {
    const failure = classifyFailure({ message: "Kaja doesn't call this method", code: "unsupported" });
    expect(failure.kind).toBe("UNSUPPORTED");
    expect(failure.code).toBe("unsupported");
  });

  it("prefers the HTTP status over the gRPC code it was tunnelled through", () => {
    const failure = classifyFailure({ message: "bad id", status: 400, code: "INVALID_ARGUMENT" });
    expect(failure.kind).toBe("INVALID_REQUEST");
    expect(failure.status).toBe(400);
  });

  it("reads a service failure by its status code", () => {
    expect(classifyFailure({ message: "bad", code: "INVALID_ARGUMENT" }).kind).toBe("INVALID_REQUEST");
    expect(classifyFailure({ message: "who", code: "UNAUTHENTICATED" }).kind).toBe("UNAUTHORIZED");
    expect(classifyFailure({ message: "later", code: "UNAVAILABLE" }).kind).toBe("TRANSPORT");
    expect(classifyFailure({ message: "oops", code: "INTERNAL" }).kind).toBe("SERVER");
    // An unrecognised code still reached a server, which refused the call.
    expect(classifyFailure({ message: "?", code: "SOMETHING_NEW" }).kind).toBe("SERVER");
  });

  // The failure the audit stalled on: no status and no code, so retrying with a
  // different request shape is wasted work.
  it("calls a broken exchange a transport failure", () => {
    const failure = classifyFailure(new Error("Wails target transport error: decoding response JSON: proto: syntax error"));
    expect(failure.kind).toBe("TRANSPORT");
    expect(failure.message).toContain("proto: syntax error");
    expect(failure.status).toBeUndefined();
  });

  it("survives an error that is not one", () => {
    expect(classifyFailure(undefined)).toEqual({ kind: "UNKNOWN", message: "" });
    expect(classifyFailure("plain string").kind).toBe("TRANSPORT");
    expect(classifyFailure({ detail: "no message here" }).message).toBe('{"detail":"no message here"}');
  });
});
