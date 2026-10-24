import { BenchlingMark, GitHubMark, SwaggerMark } from "./brandMarks";
import { canonicalEndpoint, endpointLabel } from "./knownServers";

// An API whose OpenAPI document Kaja knows the address of, so naming it is enough to
// read it. Unlike a known MCP server, nothing about signing in comes with it.
export interface KnownApi {
  name: string;
  specUrl: string;
  mark: (props: { size?: number; className?: string }) => React.ReactNode;
}

export const knownApis: KnownApi[] = [
  {
    name: "GitHub",
    specUrl: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    mark: GitHubMark,
  },
  { name: "Petstore", specUrl: "https://petstore3.swagger.io/api/v3/openapi.json", mark: SwaggerMark },
  { name: "Benchling", specUrl: "https://benchling.com/api/v3/openapi.yaml", mark: BenchlingMark },
];

export function knownApiFor(url: string): KnownApi | undefined {
  const canonical = canonicalEndpoint(url);
  if (!canonical) return undefined;
  return knownApis.find((api) => canonicalEndpoint(api.specUrl) === canonical);
}

export function matchingApis(query: string): KnownApi[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return knownApis;
  return knownApis.filter((api) => (api.name + " " + endpointLabel(api.specUrl)).toLowerCase().includes(needle));
}
