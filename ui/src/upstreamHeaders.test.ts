import { expect, test } from "bun:test";
import { parseUpstreamError, parseUpstreamHeaders, unwrapFailure, upstreamRequestLine } from "./upstreamHeaders";

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

const failure = (overrides: Record<string, unknown> = {}) => ({
  message: "Bad Request",
  status: 400,
  statusText: "Bad Request",
  request: "POST https://api.example.com/events",
  body: { title: "Bad Request", detail: "request body has an error" },
  ...overrides,
});

test("shows a failed HTTP call as the body the API sent", () => {
  expect(unwrapFailure(failure())).toEqual({ title: "Bad Request", detail: "request body has an error" });
});

// The status, the request line and the extracted message are the envelope that
// carried the body here; each is already stated somewhere that isn't the payload.
test("keeps the envelope out of the payload", () => {
  const shown = unwrapFailure(failure()) as Record<string, unknown>;
  expect(shown).not.toHaveProperty("request");
  expect(shown).not.toHaveProperty("statusText");
});

test("falls back to the message when the body says nothing", () => {
  expect(unwrapFailure(failure({ body: null, message: "Unauthorized" }))).toBe("Unauthorized");
  expect(unwrapFailure(failure({ body: "   ", message: "Bad Gateway" }))).toBe("Bad Gateway");
});

test("shows a body that is an array or a plain string as itself", () => {
  expect(unwrapFailure(failure({ body: [{ field: "id" }] }))).toEqual([{ field: "id" }]);
  expect(unwrapFailure(failure({ body: "quota exceeded" }))).toBe("quota exceeded");
});

// A gRPC or Twirp failure was never wrapped: it has no HTTP status and no
// request line, and there is nothing to see past.
test("leaves a failure that is not an HTTP one alone", () => {
  const rpcError = { message: "invalid argument", code: "INVALID_ARGUMENT" };
  expect(unwrapFailure(rpcError)).toBe(rpcError);
  expect(unwrapFailure("network down")).toBe("network down");
  expect(unwrapFailure(undefined)).toBeUndefined();
  expect(unwrapFailure(failure({ status: 0 }))).toEqual(failure({ status: 0 }));
  expect(unwrapFailure(failure({ request: "" }))).toEqual(failure({ request: "" }));
});

test("reports the request line for the Headers view, and only for a call an app made", () => {
  expect(upstreamRequestLine(failure())).toBe("POST https://api.example.com/events");
  expect(upstreamRequestLine(unreadable())).toBe("POST https://api.example.com/messages");
  expect(upstreamRequestLine({ message: "invalid argument", code: "INVALID_ARGUMENT" })).toBeUndefined();
  expect(upstreamRequestLine(undefined)).toBeUndefined();
});

// The API answered, so its answer is not the failure — what the app made of it is. The
// report is shown whole: the message that explains it, the status it arrived with, and
// the body it arrived as.
test("shows a response the app could not read as the report it is", () => {
  const report = unreadable();
  expect(unwrapFailure(report)).toBe(report);
});

function unreadable(overrides: Record<string, unknown> = {}) {
  return {
    message: "the response is not an OpenAI chat completion: invalid value for string field content",
    request: "POST https://api.example.com/messages",
    body: { content: [{ type: "text", text: "Hello" }] },
    responseStatus: 200,
    responseStatusText: "OK",
    ...overrides,
  };
}

test("returns undefined for a missing or unparseable trailer", () => {
  expect(parseUpstreamError(undefined)).toBeUndefined();
  expect(parseUpstreamError("not json")).toBeUndefined();
  expect(parseUpstreamError(escape("[1,2]"))).toBeUndefined();
  expect(parseUpstreamHeaders(undefined)).toBeUndefined();
});
