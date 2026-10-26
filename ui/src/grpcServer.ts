import { GrpcServer } from "./server/api";
import { holdsVariableReference, nameFromHost, sanitizeName } from "./appForms";

// The credential a gRPC app sends with every call. One per app, because one is what a
// service asks for; anything an API wants alongside it is a header.
export const AUTH_NONE = "none";
export const AUTH_BEARER = "bearer";
export const AUTH_BASIC = "basic";
export const AUTH_APIKEY = "apikey";

// The metadata key an API key travels under when the app doesn't name one.
export const DEFAULT_API_KEY_NAME = "x-api-key";

export const SOURCE_REFLECTION = "reflection";
export const SOURCE_PROTO_DIR = "proto_dir";

// Empty leaves the decision to the URL, which is what kaja did before an app could
// say; the form settles it from what answered.
export const TLS_AUTO = "";
export const TLS_ON = "on";
export const TLS_OFF = "off";

export interface AuthSchemeDefinition {
  key: string;
  label: string;
  // What the scheme is, in the words of the API dashboard the credential came from.
  summary: string;
}

// Bearer first: it is what most gRPC services ask for.
export const authSchemes: AuthSchemeDefinition[] = [
  { key: AUTH_BEARER, label: "Bearer token", summary: "A token in the authorization metadata" },
  { key: AUTH_APIKEY, label: "API key", summary: "A key under a metadata name the service picks" },
  { key: AUTH_BASIC, label: "HTTP Basic", summary: "A username and password" },
];

// Lower-cased, because gRPC metadata keys are.
export function apiKeyName(value: string): string {
  return (value.trim() || DEFAULT_API_KEY_NAME).toLowerCase();
}

// authNote says what kaja will do with the credential, as a literal wire format where
// that is what it is.
export function authNote(auth: string, name: string): { text: string; mono: boolean } {
  switch (auth) {
    case AUTH_BEARER:
      return { text: "authorization: Bearer ‹token›", mono: true };
    case AUTH_APIKEY:
      return { text: `${apiKeyName(name)}: ‹key›`, mono: true };
    case AUTH_BASIC:
    default:
      return { text: "", mono: false };
  }
}

// Deliberately loose — gRPC targets are written half a dozen ways, and the server is
// the one that finds out — so it only asks for a host.
export function isDialableTarget(value: string): boolean {
  if (holdsVariableReference(value)) return true;
  return targetHost(value) !== "";
}

// targetHost pulls the host out of a gRPC address, whichever of its several spellings
// was used: "dns:host:443", "dns:///host:443", "grpcs://host", or a bare "host:443".
export function targetHost(value: string): string {
  let rest = value.trim();
  if (!rest) return "";

  const scheme = /^(dns|grpc|grpcs|http|https|unix|passthrough):(\/*)/i.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);

  // A path, and any authority that isn't the host, are not the host.
  rest = rest.split("/")[0];
  rest = rest.split("@").pop() ?? "";

  // An IPv6 literal keeps its brackets around the colons that aren't the port's.
  const bracketed = /^\[([^\]]+)\]/.exec(rest);
  if (bracketed) return bracketed[1];

  return rest.replace(/:\d+$/, "");
}

// Labels that name where a service is deployed rather than what it is.
const HOST_NOISE = new Set(["api", "apis", "grpc", "grpcs", "rpc", "www", "svc", "service", "services", "dev", "staging", "stage", "prod", "test", "sandbox"]);

// deriveAppName turns what was typed into a name that reads as one word in an import
// path: "dns:quirks.kaja.tools:443" → "quirks", "grpcb.in:9000" stays, and
// "localhost:50051" falls back to what the server said it serves.
export function deriveAppName(url: string, services: string[]): string {
  return nameFromAddress(url) || nameFromServices(services);
}

// The half of deriveAppName the address can answer, which is also how the caption
// under the field knows which of the two it is looking at.
export function nameFromAddress(url: string): string {
  return nameFromHost(targetHost(url), HOST_NOISE);
}

function nameFromServices(services: string[]): string {
  const first = services[0];
  if (!first) return "";
  const parts = first.split(".");
  // A service's package is what the API calls itself; the service's own name is all
  // there is when it has none.
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return sanitizeName(name);
}

// tlsFromServer is the transport the app should record after an inspection. A server
// that never answered settled nothing, so the app keeps leaving it to the URL.
export function tlsFromServer(server: GrpcServer): string {
  if (!server.reachable) return TLS_AUTO;
  return server.tls ? TLS_ON : TLS_OFF;
}

// clientStreamingMethods counts the methods that stream from the client,
// bidirectional ones included. A stream from the server is carried on both builds; one
// from the client is carried on neither.
export function clientStreamingMethods(server: GrpcServer): number {
  return server.services.reduce((total, service) => total + service.clientStreamingMethodCount, 0);
}
