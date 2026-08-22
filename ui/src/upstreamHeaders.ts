import { MethodCallHeaders } from "./kaja";

// Trailers carrying what an in-process app exchanged with its upstream service, out
// of band from the response message. The server emits them as gRPC-Web trailers and
// the Wails transport mirrors them, so the client reads both transports the same way.
//
// The headers ones are a JSON object of header name to value. The error one is the
// HTTP failure itself, shown in place of the gRPC error the call was tunnelled through.
export const UPSTREAM_REQUEST_HEADERS_TRAILER = "kaja-upstream-request-headers";
export const UPSTREAM_RESPONSE_HEADERS_TRAILER = "kaja-upstream-response-headers";
export const UPSTREAM_ERROR_TRAILER = "kaja-upstream-error";

// An upstream HTTP call that failed, as the app reported it: the request that was
// made, what came back, and nothing about the gRPC frame it travelled in.
export interface UpstreamFailure {
  message: string;
  status: number;
  statusText: string;
  request: string;
  body: unknown;
}

// decodeTrailer reads a trailer value: RpcMetadata gives either a string or a
// single-element array, and the value is percent-encoded (escapeTrailerValue
// server-side) because trailers are read back byte by byte as Latin-1.
function decodeTrailer(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null) return undefined;
  try {
    return decodeURIComponent(String(raw));
  } catch {
    // Not a valid escape sequence; the raw value is still worth more than nothing.
    return String(raw);
  }
}

// Tolerates anything that is not a valid JSON object by returning undefined.
export function parseUpstreamHeaders(value: unknown): MethodCallHeaders | undefined {
  const decoded = decodeTrailer(value);
  if (decoded === undefined) return undefined;
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") {
      const out: MethodCallHeaders = {};
      for (const [key, headerValue] of Object.entries(parsed)) {
        out[key] = String(headerValue);
      }
      return out;
    }
  } catch {
    // Not valid JSON; ignore rather than surfacing a broken trailer.
  }
  return undefined;
}

// parseUpstreamError decodes the structured HTTP failure trailer.
export function parseUpstreamError(value: unknown): UpstreamFailure | undefined {
  const decoded = decodeTrailer(value);
  if (decoded === undefined) return undefined;
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as UpstreamFailure;
    }
  } catch {
    // Not valid JSON; fall back to whatever the transport made of the error.
  }
  return undefined;
}

// asUpstreamFailure recognizes one of these where a call's error is read back — from
// a live call or from a stored run. A status and the request that produced it are what
// an HTTP failure has and a gRPC or Twirp failure doesn't.
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
// response is just the body.
export function upstreamRequestLine(error: unknown): string | undefined {
  return asUpstreamFailure(error)?.request;
}
