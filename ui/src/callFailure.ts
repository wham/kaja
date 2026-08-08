import { isRefusal } from "./methodEffect";

// What went wrong with a call, in the one distinction a caller can act on:
// whether to change the request, the credentials, or nothing at all.
//
// A failed call reaches a script as an error whose shape depends on how it
// travelled - an HTTP status from an app that transcodes REST, a gRPC/Twirp
// status code from a service reached directly, and neither when the exchange
// itself broke. Read raw, "invalid argument" and "decoding response JSON" look
// alike, and the only way to tell them apart is to try again with a different
// request, which is wasted on a failure the request had nothing to do with.
export type FailureKind = "INVALID_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMITED" | "SERVER" | "TRANSPORT" | "REFUSED" | "UNKNOWN";

export interface CallFailure {
  kind: FailureKind;
  message: string;
  // The HTTP status of an upstream failure, or the gRPC/Twirp status code of a
  // service failure. What labels the failure where it is shown.
  status?: number;
  code?: string;
}

// How a gRPC/Twirp status maps onto the kinds. Codes not listed here are read as
// SERVER: the call reached a server and the server refused it.
const codeKinds: { [code: string]: FailureKind } = {
  invalid_argument: "INVALID_REQUEST",
  out_of_range: "INVALID_REQUEST",
  failed_precondition: "INVALID_REQUEST",
  already_exists: "INVALID_REQUEST",
  unauthenticated: "UNAUTHORIZED",
  permission_denied: "UNAUTHORIZED",
  not_found: "NOT_FOUND",
  unimplemented: "NOT_FOUND",
  resource_exhausted: "RATE_LIMITED",
  unavailable: "TRANSPORT",
  deadline_exceeded: "TRANSPORT",
  cancelled: "TRANSPORT",
};

export function classifyFailure(error: unknown): CallFailure {
  const message = failureMessage(error);
  const status = numberField(error, "status");
  const code = stringField(error, "code");

  // Kaja refused to make the call, so nothing was sent and there is no status
  // and no code to read. That looks exactly like a broken exchange from the
  // outside and means the opposite: there is something to do about it.
  if (isRefusal(error)) {
    return { kind: "REFUSED", message };
  }
  if (status !== undefined && status > 0) {
    return { kind: statusKind(status), message, status, code };
  }
  if (code) {
    return { kind: codeKinds[code.toLowerCase()] ?? "SERVER", message, code };
  }
  // Neither an HTTP status nor a status code: the call never completed an
  // exchange either side could report on. Changing the request won't help.
  return { kind: message ? "TRANSPORT" : "UNKNOWN", message };
}

function statusKind(status: number): FailureKind {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404 || status === 405 || status === 410) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  if (status >= 400) return "INVALID_REQUEST";
  return "SERVER";
}

function failureMessage(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  const message = stringField(error, "message");
  if (message) return message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field !== "" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}
