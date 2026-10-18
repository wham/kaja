import { nameFromHost, sanitizeName, urlHost } from "./appForms";

// The credential an MCP app sends with every request. One per app: a server either
// takes a bearer token, which is what the protocol's own authorization framework
// produces, or a key under a header it names. Anything else is a header.
export const AUTH_NONE = "none";
export const AUTH_BEARER = "bearer";
export const AUTH_APIKEY = "apikey";
// The credential nobody types: Kaja signs in to the server and keeps what the
// authorization server issued, renewing it as it expires. It is a bearer token on the
// wire like the one above, and everything about where it came from is Kaja's.
export const AUTH_OAUTH = "oauth";

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
  return nameFromServer(serverName) || nameFromHost(urlHost(url), HOST_NOISE);
}

// A name is a handle, so only the front of one can be. What a server reports for
// itself is its own text, and nothing else here bounds it.
const MAX_SERVER_NAME = 200;

function nameFromServer(serverName: string): string {
  // A registry identifier is a reverse-DNS namespace and then the name.
  const tail = serverName.slice(0, MAX_SERVER_NAME).split("/").pop() ?? "";
  const words = splitWords(tail);
  const kept = words.filter((word) => !NAME_NOISE.has(word.toLowerCase()));
  // A name that is nothing but noise ("huggingface.co/mcp" ends in "mcp") says
  // where the server is rather than what it is, which is the endpoint's to say.
  if (kept.length === 0) return "";
  // A name that is already one word is a handle; leave it exactly as written.
  return sanitizeName(kept.length === 1 ? kept[0] : kept.map(capitalize).join(""));
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

// eraLabel says which shape of the protocol the exchange settled on. The revision
// that dropped the handshake is a real difference in how a call is made.
export function eraLabel(protocolVersion: string, handshake: boolean): string {
  return handshake ? `MCP ${protocolVersion} · handshake` : `MCP ${protocolVersion}`;
}
