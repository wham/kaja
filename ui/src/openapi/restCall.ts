import { AppRef } from "../apps";
import { getBaseUrlForRest } from "../server/connection";
import { isWailsEnvironment } from "../wails";
import { HttpRequest, requestTarget } from "./request";

/**
 * One HTTP call, carried to the API through kaja.
 *
 * The browser never calls the API directly: it does not know where the API is and
 * must not hold the credential that opens it, and CORS would refuse most of the
 * calls it could make anyway. So the request crosses as a method, a path and a
 * body, and the process on the other side supplies the rest.
 *
 * Both builds answer the same shape. The web posts to /rest; the desktop calls
 * the bound Rest method, reached through the same dynamic import everything else
 * about Wails is, so a browser never loads the runtime.
 */

export interface RestResponse {
  status: number;
  headers: { [name: string]: string };
  // The body as text. Parsing is the caller's, because what a body is depends on
  // what the document said it would be.
  body: string;
  requestHeaders: { [name: string]: string };
  // What the upstream exchange took, as the one process in the path measured it —
  // the same number every other transport reports under kaja-upstream-*.
  durationMs?: number;
}

// The reserved names this hop answers under. The response's own headers travel as
// data rather than as headers, so nothing of kaja's shows up in the Headers view.
const STATUS = "kaja-upstream-status";
const DURATION = "kaja-upstream-duration-ms";
const RESPONSE_HEADERS = "kaja-upstream-response-headers";
const REQUEST_HEADERS = "kaja-upstream-request-headers";

export async function sendRest(appRef: AppRef, request: HttpRequest, headers: { [name: string]: string }, signal?: AbortSignal): Promise<RestResponse> {
  if (isWailsEnvironment()) {
    // The Go side of this lane exists (App.Rest), but reaching it needs the
    // generated bindings, and those are written by the Wails CLI — which is why
    // this says so rather than guessing at the call. Regenerating them is
    // `scripts/desktop-build`, and until that has been run the desktop reads a
    // REST app the compiled way.
    throw new Error("Reading a REST app from its document is not on the desktop yet — regenerate the Wails bindings to enable it.");
  }

  // The headers keep the X-Header- prefix the other lane uses, so their ${NAME}
  // references cross unexpanded and are resolved where the values live.
  const sent: { [name: string]: string } = {
    "X-Target": appRef.target,
    "X-Kaja-Method": request.method,
    "X-Kaja-Path": requestTarget(request),
  };
  for (const [name, value] of Object.entries(headers)) sent["X-Header-" + name] = value;

  const response = await fetch(getBaseUrlForRest(), {
    method: "POST",
    headers: sent,
    body: request.body ?? "",
    signal,
  });

  if (response.status === 502) {
    // This hop failed, which is not something the API said. It is reported as
    // what it is rather than passed off as an answer with an empty body.
    throw new Error((await response.text()) || "The call could not be made.");
  }

  return {
    status: Number(response.headers.get(STATUS) ?? response.status),
    headers: parseHeaders(response.headers.get(RESPONSE_HEADERS)),
    body: await response.text(),
    requestHeaders: parseHeaders(response.headers.get(REQUEST_HEADERS)),
    durationMs: numberOf(response.headers.get(DURATION)),
  };
}

function parseHeaders(value: string | null): { [name: string]: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as { [name: string]: string }) : {};
  } catch {
    return {};
  }
}

function numberOf(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
