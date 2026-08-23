import { variableReferences } from "./variableExpansion";

// The endpoint alone cannot settle which of these is meant: a gateway serves either
// at any path it likes.
export const API_OPENAI = "openai";
export const API_ANTHROPIC = "anthropic";

export const AUTH_NONE = "none";
export const AUTH_BEARER = "bearer";
export const AUTH_APIKEY = "apikey";

// The header an API key travels under when the app doesn't name one.
export const DEFAULT_API_KEY_NAME = "x-api-key";

export interface ApiChoiceDefinition {
  key: string;
  label: string;
  summary: string;
  api: string;
  // Prefilled into the endpoint, and left editable: a gateway serves the same API
  // somewhere else.
  endpoint: string;
  // The credential this API's own dashboard hands you.
  auth: string;
  // What the app is called before anyone renames it. Empty means read the endpoint.
  name: string;
}

export const CHOICE_OPENAI = "openai";
export const CHOICE_ANTHROPIC = "anthropic";
export const CHOICE_COMPATIBLE = "compatible";

export const apiChoices: ApiChoiceDefinition[] = [
  {
    key: CHOICE_OPENAI,
    label: "OpenAI",
    summary: "Chat completions, with the key as a bearer token",
    api: API_OPENAI,
    endpoint: "https://api.openai.com/v1/chat/completions",
    auth: AUTH_BEARER,
    name: "OpenAI",
  },
  {
    key: CHOICE_ANTHROPIC,
    label: "Claude",
    summary: "The Messages API, with the key under x-api-key",
    api: API_ANTHROPIC,
    endpoint: "https://api.anthropic.com/v1/messages",
    auth: AUTH_APIKEY,
    name: "Claude",
  },
  {
    key: CHOICE_COMPATIBLE,
    label: "OpenAI-compatible",
    summary: "Any other server speaking chat completions",
    api: API_OPENAI,
    endpoint: "",
    auth: AUTH_BEARER,
    name: "",
  },
];

export function getApiChoice(key: string): ApiChoiceDefinition {
  return apiChoices.find((choice) => choice.key === key) ?? apiChoices[0];
}

// matchApiChoice reads an app back onto the row that would have written it. An
// OpenAI app pointed anywhere but OpenAI's own endpoint is the compatible row,
// which is how an Azure or a gateway URL survives being edited.
export function matchApiChoice(api: string, endpoint: string): string {
  if (api.trim().toLowerCase() === API_ANTHROPIC) return CHOICE_ANTHROPIC;
  const target = endpoint.trim();
  if (!target || target === getApiChoice(CHOICE_OPENAI).endpoint) return CHOICE_OPENAI;
  return CHOICE_COMPATIBLE;
}

export interface AuthSchemeDefinition {
  key: string;
  label: string;
  summary: string;
}

// A fixed list: no document declares what a chat endpoint accepts, so the two
// shapes a credential comes in are offered outright.
export const authSchemes: AuthSchemeDefinition[] = [
  { key: AUTH_BEARER, label: "Bearer token", summary: "A key in the Authorization header" },
  { key: AUTH_APIKEY, label: "API key", summary: "A key under a header the API picks" },
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
      return { text: "Authorization: Bearer ‹key›", mono: true };
  }
}

// The browser is never handed what a ${NAME} expands to, so a value that reads one is
// taken on trust here and settled by the server.
export function holdsVariableReference(value: string): boolean {
  return variableReferences(value).length > 0;
}

// It only asks for an absolute HTTP URL: what is serving there is the server's to
// find out, and this app never reads it before the first call.
export function isUsableEndpoint(value: string): boolean {
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

// Labels that name where an API is deployed rather than what it is.
const HOST_NOISE = new Set(["api", "apis", "www", "app", "chat", "openai", "v1", "gateway", "dev", "staging", "stage", "prod", "test"]);

// deriveAppName is the row's own name where it has one, and otherwise the endpoint's
// host: "https://llm.acme.dev/v1/chat/completions" is Acme, and a host that names the
// machine rather than the service says nothing so the field stays empty.
export function deriveAppName(choice: string, endpoint: string): string {
  return getApiChoice(choice).name || nameFromEndpoint(endpoint);
}

function nameFromEndpoint(endpoint: string): string {
  let host = "";
  try {
    host = new URL(endpoint.trim()).hostname;
  } catch {
    return "";
  }
  if (!host || host === "localhost" || /^[\d.]+$/.test(host)) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 3) return sanitize(labels.join("."));
  const first = labels.findIndex((label) => !HOST_NOISE.has(label.toLowerCase()));
  return sanitize(labels[first === -1 ? 0 : first]);
}

const SEPARATORS = "._-";

// sanitize keeps only what an import path can carry, capitalized the way a name is.
function sanitize(value: string): string {
  const kept = value.replace(/[^\p{L}\p{N}._-]+/gu, "");
  let start = 0;
  let end = kept.length;
  while (start < end && SEPARATORS.includes(kept[start])) start++;
  while (end > start && SEPARATORS.includes(kept[end - 1])) end--;
  const trimmed = kept.slice(start, end);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
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
