/**
 * What an HTTP call a script made itself looks like to everything that reads a call.
 *
 * A fetch has no app, no service and no generated request, so the three things that
 * identify one are read off the request line: the host it went to, the verb, and the
 * path. Every one of them is derived here and nowhere else, because the run log, the
 * canvas, the stats table and a draft's title all have to name one call the same way.
 */

/** The request as it is recorded, which is also what `kaja.approve` draws. */
export interface FetchRequest {
  method: string;
  url: string;
  body?: unknown;
}

// Long enough for a path that identifies a resource, short enough not to push the
// duration off the row.
const MAX_KEY = 40;

// Past this a body is described rather than kept: the script has it either way, and a
// console holding twenty-five runs must not hold their downloads too.
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Where a fetch went, as the log names it. The host rather than the whole URL: two
 * hundred calls in a loop share it, which is what makes it the name and the path the
 * key that tells them apart.
 */
export function fetchHost(url: string): string {
  const parsed = parseUrl(url);
  return parsed?.host || url;
}

/** How a fetch is labelled wherever a call is named — "GET api.example.com". */
export function fetchLabel(method: string, url: string): string {
  return `${method} ${fetchHost(url)}`;
}

/** The request line, which is what the Headers view states above the headers. */
export function fetchRequestLine(method: string, url: string): string {
  return `${method} ${url}`;
}

/**
 * What tells one fetch in a loop from the next, on the same rule a request's
 * identifying field does: the path, which is the whole of what varies once the verb
 * and the host are in the name.
 */
export function fetchKey(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (!parsed) return undefined;
  const path = `${parsed.pathname}${parsed.search}`;
  if (path === "" || path === "/") return undefined;
  return path.length > MAX_KEY ? `${path.slice(0, MAX_KEY - 1)}…` : path;
}

/**
 * The host a budget belongs to, from whatever names it. A fetch is paced against the
 * server that answers it, and that is written in the URL rather than configured, so
 * "api.example.com" and "https://api.example.com/v3" name the same one.
 */
export function rateLimitHost(target: string): string {
  const trimmed = target.trim();
  const parsed = parseUrl(trimmed);
  if (parsed) return parsed.host;
  const host = trimmed.replace(/^\/\//, "").split("/")[0];
  return host.toLowerCase();
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * The request a call was made with, read without sending anything. Never throws: a
 * request kaja cannot describe is still a request the browser may be able to make,
 * so what is unreadable is left out rather than refused.
 */
export function describeRequest(input: RequestInfo | URL, init?: RequestInit): { request: FetchRequest; headers: { [name: string]: string } } {
  const target = input instanceof Request ? input : undefined;
  const method = (init?.method ?? target?.method ?? "GET").toUpperCase();
  const url = absoluteUrl(target ? target.url : String(input));
  const body = init?.body === undefined && target !== undefined ? undefined : describeBody(init?.body);
  return {
    request: body === undefined ? { method, url } : { method, url, body },
    headers: readHeaders(init?.headers ?? target?.headers),
  };
}

// A relative URL is resolved the way fetch resolves it, so the host is the one the
// call actually goes to rather than an empty string.
function absoluteUrl(url: string): string {
  const base = typeof document === "undefined" ? undefined : document.baseURI;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function readHeaders(source: HeadersInit | Headers | undefined): { [name: string]: string } {
  const headers: { [name: string]: string } = {};
  if (source === undefined) return headers;
  try {
    new Headers(source).forEach((value, name) => {
      headers[name] = value;
    });
  } catch {
    // Not headers this runtime accepts; the request is still worth reporting.
  }
  return headers;
}

/**
 * A request body as the log holds it — the object a script sent where it sent JSON,
 * so the Request tab reads like every other one. Read synchronously, because the
 * block `kaja.approve` draws is written in the same turn the call is.
 */
function describeBody(body: BodyInit | null | undefined): unknown {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return parseJson(body) ?? body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return String(body);
  if (typeof FormData !== "undefined" && body instanceof FormData) return `<FormData>`;
  if (body instanceof ArrayBuffer) return `<${body.byteLength} bytes>`;
  if (ArrayBuffer.isView(body)) return `<${body.byteLength} bytes>`;
  if (typeof Blob !== "undefined" && body instanceof Blob) return `<${body.type || "blob"}, ${body.size} bytes>`;
  return "<stream>";
}

/**
 * A response body as the log holds it: the parsed JSON where it is JSON, the text
 * where it is text, and a statement of what it was where it is neither — a payload
 * pane is no place for a megabyte of PNG decoded as UTF-8.
 */
export function readBody(bytes: ArrayBuffer, contentType: string): unknown {
  if (bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return `<${describeType(contentType)}, ${bytes.byteLength} bytes, too large to keep in the log>`;
  }
  const text = isTextual(contentType) ? new TextDecoder().decode(bytes) : isUnnamed(contentType) ? sniffText(bytes) : undefined;
  if (text === undefined) return `<${describeType(contentType)}, ${bytes.byteLength} bytes>`;
  return parseJson(text) ?? text;
}

// The types that say only that nobody named one. S3 answers `binary/octet-stream` for
// an object uploaded without a type, so what is in it is read off the bytes instead.
function isUnnamed(contentType: string): boolean {
  const type = describeType(contentType).toLowerCase();
  return type === "application/octet-stream" || type === "binary/octet-stream";
}

/**
 * The bytes as text, where they are text: valid UTF-8 with no control character a
 * text file would not hold. A NUL is what nearly every binary format has early on.
 */
export function sniffText(bytes: ArrayBuffer): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/.test(text) ? undefined : text;
}

/**
 * The response as a page a browser would draw, where it is one: declared as HTML, or
 * opening the way only an HTML document does — which is what an untyped download
 * has to be recognised by.
 */
export function htmlDocument(body: unknown, contentType: string | undefined): string | undefined {
  if (typeof body !== "string") return undefined;
  if (contentType !== undefined && describeType(contentType).toLowerCase() === "text/html") return body;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(body) ? body : undefined;
}

/**
 * The document as an iframe's `srcdoc`, with its relative references resolved
 * against the URL it was fetched from rather than against Kaja's own page.
 */
export function renderableHtml(html: string, url: string): string {
  if (/<base[\s>]/i.test(html)) return html;
  const base = `<base href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length);
  // Ahead of everything but the doctype, which has to come first to keep the page
  // out of quirks mode.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + base + html.slice(at);
}

function describeType(contentType: string): string {
  const type = contentType.split(";")[0]?.trim();
  return type ? type : "binary";
}

// No content type at all is read as text: an API that says nothing is far more often
// answering with JSON than with an image.
function isTextual(contentType: string): boolean {
  const type = describeType(contentType).toLowerCase();
  if (type === "binary") return true;
  return type.startsWith("text/") || type.endsWith("/json") || type.endsWith("+json") || type.endsWith("+xml") || TEXTUAL_TYPES.has(type);
}

const TEXTUAL_TYPES = new Set([
  "application/xml",
  "application/javascript",
  "application/ecmascript",
  "application/x-www-form-urlencoded",
  "application/graphql",
]);

// Only a JSON object or array: a bare number or a quoted string reads better as the
// text it was, and "null" is not a body worth turning into one.
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * One signal that follows several. The run's own abort is what Stop reaches a call
 * through, and a script that brought a signal of its own keeps it — so a fetch obeys
 * both rather than whichever kaja happened to pass last.
 */
export function combineSignals(signals: (AbortSignal | undefined)[]): { signal?: AbortSignal; release: () => void } {
  const live = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (live.length === 0) return { release: () => {} };
  if (live.length === 1) return { signal: live[0], release: () => {} };

  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    // Removed when the call settles: a run's signal outlives its calls, and a
    // listener per call left on it is a leak the length of the run.
    listeners.push(() => signal.removeEventListener("abort", abort));
  }
  return {
    signal: controller.signal,
    release: () => {
      for (const remove of listeners) remove();
    },
  };
}

// A response with no body of its own. Handing one to the Response constructor is an
// error rather than an empty response.
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * The response, read once and handed over again. A body can only be consumed once,
 * and the log has to hold it, so what the script gets back is a response over the same
 * bytes — `.ok`, `.status`, `.headers`, `.json()` and `.text()` all as they were.
 *
 * The whole body is read before the script sees any of it, which is what makes a
 * streamed response the one thing a script's fetch does not carry.
 */
export async function holdResponse(response: Response): Promise<{ response: Response; body: unknown; bytes?: number }> {
  // An opaque response (a no-cors request) has nothing to read and no status to
  // rebuild it under, so it is passed through as it came.
  if (response.type === "opaque" || response.status === 0) return { response, body: undefined };
  const bytes = await response.arrayBuffer();
  return { response: replayResponse(response, bytes), body: readBody(bytes, response.headers.get("content-type") ?? ""), bytes: bytes.byteLength };
}

function replayResponse(response: Response, bytes: ArrayBuffer): Response {
  const body = NULL_BODY_STATUS.has(response.status) || bytes.byteLength === 0 ? null : bytes;
  const replayed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  // Neither survives the constructor, and a script that followed a redirect reads
  // `url` to find out where it ended up.
  Object.defineProperty(replayed, "url", { value: response.url });
  Object.defineProperty(replayed, "redirected", { value: response.redirected });
  return replayed;
}

/** The headers the API answered with, which is what a rate limiter reads. */
export function readResponseHeaders(response: Response): { [name: string]: string } {
  const headers: { [name: string]: string } = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}
