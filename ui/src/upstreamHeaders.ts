import { MethodCallHeaders } from "./kaja";

// Trailers carrying what an in-process app (e.g. OpenAPI) exchanged with its
// upstream service, out of band from the response message. The server emits them
// as gRPC-Web trailers and the Wails transport mirrors them, so the client reads
// both transports the same way.
//
// The headers ones are a JSON object of header name to value each, surfaced in
// the Headers view separately from the transport headers. The error one is the
// HTTP failure itself, shown in place of the gRPC error the call was tunnelled
// through — see UpstreamFailure below.
export const UPSTREAM_REQUEST_HEADERS_TRAILER = "kaja-upstream-request-headers";
export const UPSTREAM_RESPONSE_HEADERS_TRAILER = "kaja-upstream-response-headers";
export const UPSTREAM_ERROR_TRAILER = "kaja-upstream-error";

// An upstream HTTP call that failed, as the app reported it. This is what the
// console shows for a failed call against an HTTP app: the request that was
// made, what came back, and nothing about the gRPC frame it travelled in.
export interface UpstreamFailure {
  message: string;
  status: number;
  statusText: string;
  request: string;
  body: unknown;
}

// decodeTrailer reads a trailer value: RpcMetadata gives either a string or a
// single-element array, and the value is percent-encoded (see escapeTrailerValue
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

// parseUpstreamHeaders decodes a header-map trailer value, tolerating anything
// that is not a valid JSON object by returning undefined.
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
