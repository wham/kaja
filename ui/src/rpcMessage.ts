/**
 * What a failed call says. A gRPC status message is percent-encoded UTF-8 by spec, and
 * the gRPC-Web client reads a trailer byte by byte and hands the value through as it
 * found it — so the decoding happens here, at the one place a failure is read for its
 * sentence, rather than in each caller.
 */
export function rpcErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === "string" ? error : String(error);
  }
  if (typeof (error as { code?: unknown }).code !== "string") {
    return error.message;
  }
  try {
    return decodeURIComponent(error.message);
  } catch {
    return error.message;
  }
}
