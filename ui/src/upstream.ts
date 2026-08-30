import { MethodCallHeaders } from "./kaja";

// UPSTREAM_TRAILER carries what happened upstream of Kaja, out of band from the
// response message: the hop Kaja made on the call's behalf, how long it took, and the
// failure when there was one. It is one gRPC-Web trailer holding one object, so the
// client reads one thing, once — where four names meant four values to escape, four to
// parse, and four passes of the trailer block's budget.
//
// It is the response side of the reserved X-Kaja-App request header: Kaja's own
// channel, never a header the server sent, which is why the client consumes it rather
// than showing it among the response headers.
export const UPSTREAM_TRAILER = "kaja-upstream";

// Upstream is that object. Every field is optional because a call reports only what it
// had: a local app exchanged no headers, and a call that succeeded has no failure.
export interface Upstream {
  requestHeaders?: MethodCallHeaders;
  responseHeaders?: MethodCallHeaders;
  durationMs?: number;
  // The HTTP failure itself, shown in place of the gRPC error the call was tunnelled
  // through.
  error?: UpstreamFailure;
}

// An upstream HTTP call that failed, as the app reported it: the request that was
// made, what came back, and nothing about the gRPC frame it travelled in.
//
// A response the app could not read is the other half of the same report and carries
// its status under `responseStatus` instead. The API answered, so the message is the
// app's reading of that answer rather than a summary lifted out of it — showing it as
// an HTTP failure would label the call with a success code and drop the one line that
// explains it, so the whole report is shown as it stands.
export interface UpstreamFailure {
  message: string;
  status: number;
  statusText: string;
  request: string;
  body: unknown;
}

// parseUpstream reads the trailer. RpcMetadata gives either a string or a
// single-element array, and the value is percent-encoded (escapeTrailerValue
// server-side) because a trailer block is read back byte by byte as Latin-1. Anything
// that is not the object it should be reads as a call that reported nothing, which is
// what a missing trailer already means.
export function parseUpstream(value: unknown): Upstream | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null) return undefined;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Not a valid escape sequence; the raw value is still worth more than nothing.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const object = parsed as Record<string, unknown>;
  return {
    requestHeaders: headersOf(object.requestHeaders),
    responseHeaders: headersOf(object.responseHeaders),
    durationMs: durationOf(object.durationMs),
    error: object.error && typeof object.error === "object" && !Array.isArray(object.error) ? (object.error as UpstreamFailure) : undefined,
  };
}

function headersOf(value: unknown): MethodCallHeaders | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers: MethodCallHeaders = {};
  for (const [name, headerValue] of Object.entries(value)) {
    headers[name] = String(headerValue);
  }
  return headers;
}

// A duration is a non-negative number of milliseconds and nothing else — a mangled one
// reads as never measured, which is what makes the client fall back on its own timing.
function durationOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

// asUpstreamFailure recognizes one of these where a call's error is read back — from
// a live call or from a stored run. A status and the request that produced it are what
// an HTTP failure has and a gRPC failure doesn't.
function asUpstreamFailure(error: unknown): UpstreamFailure | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Partial<UpstreamFailure>;
  if (typeof candidate.status !== "number" || candidate.status <= 0) return undefined;
  if (typeof candidate.request !== "string" || candidate.request === "") return undefined;
  return candidate as UpstreamFailure;
}

// unwrapFailure is what a failed call is shown as, on the same rule as unwrapEnvelope:
// an HTTP failure is the response body the API sent, and the fields around it are the
// envelope carrying it here. The status is already on the console's status line and
// the request line sits with its headers.
//
// The error object is untouched — a script still catches `status`, which is what
// classifyFailure reads — so this only decides what gets displayed.
export function unwrapFailure(error: unknown): unknown {
  const failure = asUpstreamFailure(error);
  if (!failure) return error;
  const body = failure.body;
  // A body is not always worth showing: an empty 401, a 502 with nothing in it. Then
  // the message extracted upstream is the only thing there is to say.
  if (body === undefined || body === null) return failure.message;
  if (typeof body === "string" && body.trim() === "") return failure.message;
  return body;
}

// upstreamRequestLine is the HTTP request an app made, for the Headers view to state
// above the headers that went with it — the only place a request line is left once the
// response is just the body. Read off the request alone, so an unreadable response
// states its call the same way a refused one does.
export function upstreamRequestLine(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const request = (error as { request?: unknown }).request;
  return typeof request === "string" && request !== "" ? request : undefined;
}
