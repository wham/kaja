import { MethodCallHeaders } from "./kaja";

// Trailer keys carrying the headers an in-process app (e.g. OpenAPI) exchanged
// with its upstream service, each a JSON object of header name to value. The
// server emits them as gRPC-Web trailers and the Wails transport mirrors them,
// so the client surfaces them uniformly, separate from the transport headers.
export const UPSTREAM_REQUEST_HEADERS_TRAILER = "kaja-upstream-request-headers";
export const UPSTREAM_RESPONSE_HEADERS_TRAILER = "kaja-upstream-response-headers";

// parseUpstreamHeaders decodes a header-map trailer value, tolerating anything
// that is not a valid JSON object by returning undefined. Trailer values may
// arrive as a string or a single-element string array (RpcMetadata).
export function parseUpstreamHeaders(value: unknown): MethodCallHeaders | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    const parsed = JSON.parse(String(raw));
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
