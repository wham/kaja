import { expect, test } from "bun:test";
import { parseUpstreamError, parseUpstreamHeaders } from "./upstreamHeaders";

// Trailers are percent-encoded on the way out because a gRPC-Web client reads
// them byte by byte as Latin-1; without it an em dash arrives as "â€"".
const escape = (value: string) =>
  [...new TextEncoder().encode(value)]
    .map((b) => (b < 0x20 || b > 0x7e || b === 0x25 ? "%" + b.toString(16).toUpperCase().padStart(2, "0") : String.fromCharCode(b)))
    .join("");

test("decodes a header trailer, including non-ASCII values", () => {
  const headers = { "Content-Type": "application/problem+json", "X-Note": "café — closed" };
  expect(parseUpstreamHeaders(escape(JSON.stringify(headers)))).toEqual(headers);
});

test("reads a header trailer from a single-element metadata array", () => {
  expect(parseUpstreamHeaders([escape('{"Accept":"application/json"}')])).toEqual({ Accept: "application/json" });
});

test("decodes the structured HTTP failure, keeping the body a value", () => {
  const failure = {
    message: 'no show "glass-mountainz" — list them all',
    status: 404,
    statusText: "Not Found",
    request: "GET https://api.example.com/shows/glass-mountainz",
    body: { detail: 'no show "glass-mountainz" — list them all', status: 404, title: "Show not found" },
  };

  const parsed = parseUpstreamError(escape(JSON.stringify(failure)));
  expect(parsed).toEqual(failure);
  // The body is a value, not a string of JSON the console would show escaped.
  expect(typeof parsed!.body).toBe("object");
});

// A percent sign in a value is escaped on the way out, so it survives rather
// than being read as the start of an escape sequence.
test("round-trips a value containing a percent sign", () => {
  expect(parseUpstreamHeaders(escape('{"X-Ratio":"50% off"}'))).toEqual({ "X-Ratio": "50% off" });
});

test("returns undefined for a missing or unparseable trailer", () => {
  expect(parseUpstreamError(undefined)).toBeUndefined();
  expect(parseUpstreamError("not json")).toBeUndefined();
  expect(parseUpstreamError(escape("[1,2]"))).toBeUndefined();
  expect(parseUpstreamHeaders(undefined)).toBeUndefined();
});
