import { OpenApiDocument, OpenApiSecurityScheme, OpenApiServer } from "./server/api";
import { variableReferences } from "./variableExpansion";

// Sending no credentials is a choice like any other scheme, so it is a row in the same
// list. Stored in security_scheme, which the server understands.
export const NO_CREDENTIALS = "none";

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.host !== "";
  } catch {
    return false;
  }
}

// The browser is never handed what a ${NAME} expands to, so a value that reads one is
// taken on trust here and settled by the server.
export function holdsVariableReference(value: string): boolean {
  return variableReferences(value).length > 0;
}

// Also rejects a URL with a {placeholder} left in it, which would otherwise be sent
// as part of the host.
export function isUsableBaseUrl(value: string): boolean {
  if (holdsVariableReference(value)) return true;
  return isAbsoluteHttpUrl(value) && !value.includes("{");
}

// Words a title carries because it names a document rather than the API inside it.
const TITLE_NOISE = new Set([
  "the",
  "api",
  "apis",
  "rest",
  "restful",
  "http",
  "https",
  "web",
  "service",
  "services",
  "server",
  "cloud",
  "platform",
  "public",
  "openapi",
  "swagger",
  "spec",
  "specs",
  "specification",
  "docs",
  "documentation",
  "reference",
  "version",
]);

// deriveAppName turns a document title into a name that reads as one word in an
// import path: "OpenMeter Cloud API" → "OpenMeter", "Swagger Petstore - OpenAPI 3.0"
// → "Petstore".
export function deriveAppName(title: string): string {
  // A subtitle describes the document too, so the title stops at the first one.
  const head = title.split(/\s+[–—|]\s+|\s+-\s+|:\s+|\s+\(/)[0] ?? "";
  const words = titleWords(head);
  const kept = words.filter((word) => !TITLE_NOISE.has(word.toLowerCase()) && !isVersionWord(word));
  return joinWords(kept.length > 0 ? kept : words) || joinWords(titleWords(title));
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

// Everything that isn't a letter, a digit or an interior dot is a separator, so a
// title holding a slash or a quote can't produce a name that breaks its import path.
function titleWords(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

function isVersionWord(word: string): boolean {
  return /^v?\d+(\.\d+)*$/i.test(word);
}

// A single word is kept as written, so a title that is already a handle ("grpcb.in")
// survives; several are joined in PascalCase, since a space in the name is a space in
// every import path.
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return words.map(capitalizeWord).join("");
}

function capitalizeWord(word: string): string {
  const first = word.charAt(0);
  return first === first.toLowerCase() ? first.toUpperCase() + word.slice(1) : word;
}

export function defaultVariableValues(server: OpenApiServer): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of server.variables) {
    values[variable.name] = variable.defaultValue || variable.enumValues[0] || "";
  }
  return values;
}

export function resolveServerUrl(server: OpenApiServer, values: Record<string, string>): string {
  let url = server.url;
  for (const variable of server.variables) {
    url = url.split(`{${variable.name}}`).join(values[variable.name] ?? variable.defaultValue);
  }
  return url;
}

// matchServerUrl reports whether a configured base URL came from this server,
// recovering the values its {placeholders} were resolved with. That is what lets an app
// being edited show the server it was created against rather than the document's first.
export function matchServerUrl(server: OpenApiServer, url: string): Record<string, string> | null {
  if (!url) return null;
  if (server.variables.length === 0) {
    return trimSlash(server.url) === trimSlash(url) ? {} : null;
  }
  const names: string[] = [];
  const pattern = trimSlash(server.url).replace(/\{([^}]+)\}|[.*+?^${}()|[\]\\]/g, (match, name?: string) => {
    if (name === undefined) return `\\${match}`;
    names.push(name);
    return "([^/]+)";
  });
  const matched = new RegExp(`^${pattern}$`).exec(trimSlash(url));
  if (!matched) return null;
  const values: Record<string, string> = {};
  names.forEach((name, index) => {
    values[name] = matched[index + 1];
  });
  return values;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// defaultSecurityScheme preselects the scheme the most operations accept, which is
// the first one the server sorted. A document that declares none pins nothing.
export function defaultSecurityScheme(document: OpenApiDocument): string {
  if (document.securitySchemes.length === 0) return "";
  return document.securitySchemes.find((scheme) => scheme.type !== "mutualTLS")?.key ?? NO_CREDENTIALS;
}

export function schemeLabel(scheme: OpenApiSecurityScheme): string {
  switch (scheme.type) {
    case "apiKey":
      return "API key";
    case "oauth2":
      return "OAuth 2.0";
    case "openIdConnect":
      return "OpenID Connect";
    case "mutualTLS":
      return "Mutual TLS";
    case "http": {
      const httpScheme = scheme.scheme.toLowerCase();
      if (httpScheme === "basic") return "HTTP Basic";
      if (httpScheme === "bearer" || httpScheme === "") return "Bearer token";
      return `HTTP ${scheme.scheme.charAt(0).toUpperCase()}${scheme.scheme.slice(1)}`;
    }
    default:
      return scheme.type || scheme.key;
  }
}

// schemeIdentity is how the scheme is written in the document, so the user can
// recognise it from their API dashboard.
export function schemeIdentity(scheme: OpenApiSecurityScheme): string {
  if (scheme.type === "apiKey") {
    const placement = scheme.in === "query" ? `query ?${scheme.parameterName}=` : `${scheme.in || "header"} ${scheme.parameterName}`;
    return `${scheme.key} · ${placement}`;
  }
  if (scheme.type === "http" && scheme.bearerFormat) {
    return `${scheme.key} · ${scheme.bearerFormat}`;
  }
  return scheme.key;
}

export function isBasicScheme(scheme: OpenApiSecurityScheme): boolean {
  return scheme.type === "http" && scheme.scheme.toLowerCase() === "basic";
}

export function credentialPlaceholder(scheme: OpenApiSecurityScheme): string {
  if (scheme.type === "apiKey") {
    return scheme.in === "query" ? `Value appended to every request as ?${scheme.parameterName}=` : `Value sent as ${scheme.parameterName}`;
  }
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") return "Access token";
  return "Token";
}

// credentialNote says what kaja will do with the credential, as a literal wire format
// where that is what it is.
export function credentialNote(scheme: OpenApiSecurityScheme): { text: string; mono: boolean } {
  if (isBasicScheme(scheme)) {
    return { text: "Base64 encoding is Kaja's to do, never yours.", mono: false };
  }
  if (scheme.type === "apiKey") {
    if (scheme.in === "cookie") return { text: `Cookie: ${scheme.parameterName}=‹key›`, mono: true };
    if (scheme.in === "query") return { text: `?${scheme.parameterName}=‹key›`, mono: true };
    return { text: `${scheme.parameterName}: ‹key›`, mono: true };
  }
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
    return { text: "Sent as a bearer token. Kaja doesn't run the authorization flow yet — paste a token you already hold.", mono: false };
  }
  if (scheme.type === "http" && scheme.scheme && scheme.scheme.toLowerCase() !== "bearer") {
    return { text: `Sent verbatim after ${scheme.scheme}. Kaja doesn't perform the challenge handshake.`, mono: false };
  }
  return { text: "Authorization: Bearer ‹token›", mono: true };
}
