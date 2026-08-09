import { variableReferences } from "./variableExpansion";

// The credential an MCP app sends with every request. One per app: a server
// either takes a bearer token, which is what the protocol's own authorization
// framework produces, or a key under a header it names. Anything else is a
// header.
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

// The schemes, in the order they are offered. Bearer first: MCP's authorization
// framework is OAuth, and what OAuth hands back is a bearer token.
export const authSchemes: AuthSchemeDefinition[] = [
  { key: AUTH_BEARER, label: "Bearer token", summary: "A token in the Authorization header" },
  { key: AUTH_APIKEY, label: "API key", summary: "A key under a header the server picks" },
];

export function apiKeyName(value: string): string {
  return value.trim() || DEFAULT_API_KEY_NAME;
}

// authNote says what Kaja will send. Where that is a literal wire format, it is
// shown as one.
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

// holdsVariableReference reports whether a value reads a ${NAME} variable. The
// browser is never handed what one expands to, so a value that reads one is
// taken on trust here and settled by the server.
export function holdsVariableReference(value: string): boolean {
  return variableReferences(value).length > 0;
}

// isReadableEndpoint reports whether an endpoint is worth reaching for. It only
// asks for an absolute HTTP URL: whether anything is serving MCP there is the
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

// Words that say the thing is an MCP server rather than what it is, so a name
// derived from one doesn't come out as "Server" or "MCP".
const NAME_NOISE = new Set(["mcp", "server", "servers", "service", "api", "apis", "remote", "official", "streamable", "http", "sse", "tools"]);

// Labels that name where a server is deployed rather than what it is.
const HOST_NOISE = new Set(["mcp", "api", "apis", "www", "app", "server", "remote", "dev", "staging", "stage", "prod", "test", "sandbox"]);

// deriveAppName turns what the server calls itself into a name that reads as one
// word in an import path. A server name is usually already a handle, so unlike
// an OpenAPI title it is mostly kept: what goes is the part that says it is an
// MCP server ("GitHub MCP Server" becomes "GitHub"), and the namespace a
// registry entry carries in front of it ("io.github.owner/sentry" becomes
// "Sentry"). A server that names itself nothing useful is named by its host.
export function deriveAppName(url: string, serverName: string): string {
  return nameFromServer(serverName) || nameFromEndpoint(url);
}

function nameFromServer(serverName: string): string {
  // A registry identifier is a reverse-DNS namespace and then the name.
  const tail = serverName.split("/").pop() ?? "";
  const words = splitWords(tail);
  const kept = words.filter((word) => !NAME_NOISE.has(word.toLowerCase()));
  const chosen = kept.length > 0 ? kept : words;
  if (chosen.length === 0) return "";
  // A name that is already one word is a handle; leave it exactly as written.
  return chosen.length === 1 ? sanitize(chosen[0]) : sanitize(chosen.map(capitalize).join(""));
}

// nameFromEndpoint is the half of deriveAppName the URL can answer, for a server
// that names itself nothing an import path could carry.
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

// splitWords breaks a name on anything that isn't a letter or a digit, and on
// the case boundaries inside each word. The last capital of a run belongs to the
// word after it, so "GitHubMCPServer" is GitHub, MCP, Server rather than one
// word the noise list can't see into.
function splitWords(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((part) => part.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u))
    .filter(Boolean);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function sanitize(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "").replace(/^[._-]+|[._-]+$/g, "");
}

// uniqueAppName keeps a derived name a starting point rather than a collision: a
// second server that names itself the same becomes "GitHub2".
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

// eraLabel says which shape of the protocol the exchange settled on. The
// revision that dropped the handshake is a real difference in how a call is
// made, and a server on either side of it is worth telling apart.
export function eraLabel(protocolVersion: string, handshake: boolean): string {
  return handshake ? `MCP ${protocolVersion} · handshake` : `MCP ${protocolVersion}`;
}
