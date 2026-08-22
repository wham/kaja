import { variableReferences } from "./variableExpansion";

// The credential an MCP app sends with every request. One per app: a server either
// takes a bearer token, which is what the protocol's own authorization framework
// produces, or a key under a header it names. Anything else is a header.
export const AUTH_NONE = "none";
export const AUTH_BEARER = "bearer";
export const AUTH_APIKEY = "apikey";

// The header an API key travels under when the app doesn't name one.
export const DEFAULT_API_KEY_NAME = "X-API-Key";

export interface AuthSchemeDefinition {
  key: string;
  label: string;
  // What the scheme is, in the words of the dashboard the credential came from.
  summary: string;
}

// Bearer first: MCP's authorization framework is OAuth, and what OAuth hands back is
// a bearer token.
export const authSchemes: AuthSchemeDefinition[] = [
  { key: AUTH_BEARER, label: "Bearer token", summary: "A token in the Authorization header" },
  { key: AUTH_APIKEY, label: "API key", summary: "A key under a header the server picks" },
];

export function apiKeyName(value: string): string {
  return value.trim() || DEFAULT_API_KEY_NAME;
}

// authNote says what Kaja will send, as a literal wire format where that is what it is.
export function authNote(auth: string, name: string): { text: string; mono: boolean } {
  switch (auth) {
    case AUTH_APIKEY:
      return { text: `${apiKeyName(name)}: ‹key›`, mono: true };
    case AUTH_NONE:
      return { text: "", mono: false };
    default:
      return { text: "Authorization: Bearer ‹token›", mono: true };
  }
}

// The browser is never handed what a ${NAME} expands to, so a value that reads one is
// taken on trust here and settled by the server.
export function holdsVariableReference(value: string): boolean {
  return variableReferences(value).length > 0;
}

// It only asks for an absolute HTTP URL: whether anything is serving MCP there is the
// server's to find out.
export function isReadableEndpoint(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (holdsVariableReference(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

// Words that say the thing is an MCP server rather than what it is.
const NAME_NOISE = new Set(["mcp", "server", "servers", "service", "api", "apis", "remote", "official", "streamable", "http", "sse", "tools"]);

// Labels that name where a server is deployed rather than what it is.
const HOST_NOISE = new Set(["mcp", "api", "apis", "www", "app", "server", "remote", "dev", "staging", "stage", "prod", "test", "sandbox"]);

// deriveAppName turns what the server calls itself into a name that reads as one word
// in an import path. A server name is usually already a handle, so unlike an OpenAPI
// title it is mostly kept: what goes is the part saying it is an MCP server ("GitHub
// MCP Server" → "GitHub") and a registry namespace ("io.github.owner/sentry" →
// "Sentry"). A server that names itself nothing useful is named by its host.
export function deriveAppName(url: string, serverName: string): string {
  return nameFromServer(serverName) || nameFromEndpoint(url);
}

// A name is a handle, so only the front of one can be. What a server reports for
// itself is its own text, and nothing else here bounds it.
const MAX_SERVER_NAME = 200;

function nameFromServer(serverName: string): string {
  // A registry identifier is a reverse-DNS namespace and then the name.
  const tail = serverName.slice(0, MAX_SERVER_NAME).split("/").pop() ?? "";
  const words = splitWords(tail);
  const kept = words.filter((word) => !NAME_NOISE.has(word.toLowerCase()));
  const chosen = kept.length > 0 ? kept : words;
  if (chosen.length === 0) return "";
  // A name that is already one word is a handle; leave it exactly as written.
  return chosen.length === 1 ? sanitize(chosen[0]) : sanitize(chosen.map(capitalize).join(""));
}

// The half of deriveAppName the URL can answer.
function nameFromEndpoint(url: string): string {
  let host = "";
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return "";
  }
  if (!host || host === "localhost" || /^[\d.]+$/.test(host)) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 3) return sanitize(labels.join("."));
  const first = labels.findIndex((label) => !HOST_NOISE.has(label.toLowerCase()));
  return sanitize(labels[first === -1 ? 0 : first]);
}

// splitWords breaks on anything that isn't a letter or a digit, and on the case
// boundaries inside each word. The last capital of a run belongs to the word after it,
// so "GitHubMCPServer" is GitHub, MCP, Server rather than one word the noise list
// can't see into.
function splitWords(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((part) => part.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u))
    .filter(Boolean);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const SEPARATORS = "._-";

// sanitize keeps only what an import path can carry. The trimming is a scan rather
// than an anchored `/^[._-]+|[._-]+$/` replace, which backtracks quadratically on a
// string that is whatever a server chose to call itself.
function sanitize(value: string): string {
  const kept = value.replace(/[^\p{L}\p{N}._-]+/gu, "");
  let start = 0;
  let end = kept.length;
  while (start < end && SEPARATORS.includes(kept[start])) start++;
  while (end > start && SEPARATORS.includes(kept[end - 1])) end--;
  return kept.slice(start, end);
}

// uniqueAppName keeps a derived name a starting point rather than a collision.
export function uniqueAppName(name: string, taken: string[]): string {
  if (!name || !taken.includes(name)) return name;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${name}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return name;
}

export function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

// eraLabel says which shape of the protocol the exchange settled on. The revision
// that dropped the handshake is a real difference in how a call is made.
export function eraLabel(protocolVersion: string, handshake: boolean): string {
  return handshake ? `MCP ${protocolVersion} · handshake` : `MCP ${protocolVersion}`;
}
