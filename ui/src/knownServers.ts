import { GitHubMark, type BrandMark } from "./brandMarks";

// A server Kaja is set up for: a name, the endpoint it is reached at, and the mark it
// is recognised by. An entry exists where signing in is something Kaja can carry
// through without being told anything - which is the server's authorization server
// having an entry in the Go side's own list - so being on this list is what "sign-in
// ready" says.
export interface KnownServer {
  name: string;
  endpoint: string;
  mark: BrandMark;
}

export const knownServers: KnownServer[] = [{ name: "GitHub", endpoint: "https://api.githubcopilot.com/mcp/", mark: GitHubMark }];

// The address without the scheme, which is how a server is written down everywhere
// but in the field itself.
export function endpointLabel(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "");
}

// canonicalEndpoint is the address an entry is matched on: the scheme and host as the
// URL parser reads them, without a default port, a fragment, or a trailing slash. It
// is the rule the Go side keeps a token under, said in the browser.
export function canonicalEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

// The match is on the endpoint and nothing else, so it is exact: what a server calls
// itself is not read, and an address that is a ${VARIABLE}, a localhost port or
// anything else nobody bundled simply isn't one of these.
export function knownServerFor(url: string): KnownServer | undefined {
  const canonical = canonicalEndpoint(url);
  if (!canonical) return undefined;
  return knownServers.find((server) => canonicalEndpoint(server.endpoint) === canonical);
}

// What the field offers while it is being typed into: a name or an address the query
// appears in.
export function matchingServers(query: string): KnownServer[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return knownServers;
  return knownServers.filter((server) => (server.name + " " + endpointLabel(server.endpoint)).toLowerCase().includes(needle));
}
