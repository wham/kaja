import { describe, expect, test } from "bun:test";
import { parseMethodRequest } from "./methodRequest";

describe("parseMethodRequest", () => {
  test("tells a read from a write by the verb", () => {
    expect(parseMethodRequest("GET /items")).toEqual({ verb: "GET", path: "/items", write: false });
    expect(parseMethodRequest("patch /items/{id}")).toEqual({ verb: "PATCH", path: "/items/{id}", write: true });
  });

  test("has nothing to say about a method with no request", () => {
    expect(parseMethodRequest(undefined)).toBeUndefined();
    expect(parseMethodRequest("")).toBeUndefined();
  });
});
