import { FetchRequest } from "./fetchCall";
import { getBaseUrlForApi } from "./server/connection";
import { isWailsEnvironment } from "./wails";

/**
 * Who makes the request a script's `fetch` describes.
 *
 * On the web it is the browser, which is the whole of why a deployed kaja is not a
 * proxy for arbitrary URLs: the page reaches exactly what a page can reach, and an
 * API sending no CORS headers needs an app. On the desktop the page cannot reach
 * anything — it is served from `wails://`, which WebKit reads as an insecure, opaque
 * origin, so an https request fails before it is sent and no API could allow it. The
 * process behind that webview is the machine the script is running on, so it makes
 * the call and hands the answer back through the lane it already mounts.
 *
 * Nothing above this knows which happened: what comes back is the `Response` fetch
 * would have handed over either way.
 */
export function sendFetch(request: FetchRequest, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isWailsEnvironment()) {
    return sendThroughDesktop(request, input, init);
  }
  return fetch(input as RequestInfo, init);
}

// Kaja's own channel on the lane, consumed here and never shown as a response header,
// on the same rule kaja-upstream is read at the one boundary.
const METHOD_HEADER = "X-Kaja-Fetch-Method";
const URL_HEADER = "X-Kaja-Fetch-Url";
const ERROR_HEADER = "X-Kaja-Fetch-Error";

// The script's own headers, under the prefix the app lane already forwards them by.
const HEADER_PREFIX = "X-Header-";

/** The lane, on the page's own origin — the door beside /Api and /app. */
export function desktopFetchUrl(): string {
  return `${getBaseUrlForApi()}/fetch`;
}

export async function sendThroughDesktop(request: FetchRequest, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Built the way fetch would have built it, so what the lane forwards is what the
  // script asked for — the headers it merged, the body it framed, the signal it
  // brought — rather than a second reading of the arguments.
  const outgoing = new Request(input as RequestInfo, init);
  const headers = new Headers();
  outgoing.headers.forEach((value, name) => headers.set(`${HEADER_PREFIX}${name}`, value));
  headers.set(METHOD_HEADER, request.method);
  headers.set(URL_HEADER, request.url);
  // The call the page would have made is the one the API should see, and a Go process
  // introduces itself as one. User-Agent is a forbidden header name, so this is never
  // one the script set — the browser would have dropped that too.
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    headers.set(`${HEADER_PREFIX}User-Agent`, navigator.userAgent);
  }

  const body = await outgoing.arrayBuffer();
  const answer = await fetch(desktopFetchUrl(), {
    method: "POST",
    headers,
    body: body.byteLength > 0 ? body : undefined,
    signal: outgoing.signal,
  });

  const failure = answer.headers.get(ERROR_HEADER);
  // A request that never completed, which is what fetch throws for. A TypeError
  // because that is what fetch throws, and the message is the lane's own.
  if (failure) throw new TypeError(failure);

  return apiResponse(answer, request.url);
}

// The API's answer as the script sees it: the lane's status, the API's own headers,
// and the URL the response was finally read from.
function apiResponse(answer: Response, requested: string): Response {
  const finalUrl = answer.headers.get(URL_HEADER) ?? requested;
  const headers = new Headers(answer.headers);
  headers.delete(URL_HEADER);

  const response = new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
  // Neither survives the constructor, and a script that followed a redirect reads
  // `url` to find out where it ended up.
  Object.defineProperty(response, "url", { value: finalUrl });
  Object.defineProperty(response, "redirected", { value: finalUrl !== requested });
  return response;
}
