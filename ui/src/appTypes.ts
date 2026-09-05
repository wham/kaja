import { FolderOpen, Sparkles, type LucideIcon } from "lucide-react";
import { GrpcMark, McpMark, OpenApiMark, TwirpMark } from "./protocolMarks";
import { ConfigurationApp } from "./server/api";

// Parameter kinds an app exposes in the New form. "file" and "folder" render a native
// picker on the desktop and a plain text field elsewhere; "upload" reads a chosen
// file's text content into the parameter value, on both.
export type AppParameterType = "text" | "url" | "file" | "folder" | "boolean" | "upload";

export interface AppParameterDefinition {
  key: string;
  label: string;
  type: AppParameterType;
  placeholder?: string;
  caption?: string;
  // Optional parameters are not required to create the app.
  optional?: boolean;
  // A path the desktop cannot take on trust: macOS grants a sandboxed app a folder by
  // the user choosing it, so a typed one has no access at all. There the field is
  // read-only, clicking it or the picker is what writes it, and these stand in for the
  // placeholder and caption beside them.
  picked?: { placeholder: string; caption: string };
}

// AppSurface is how much an app turned out to expose, which a custom form reads off
// the server or the document it just read. It is what the footer counts.
export interface AppSurface {
  count: number;
}

export interface AppTypeDefinition {
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
  parameters: AppParameterDefinition[];
  // Groups of parameter keys where at least one must be provided (e.g. an OpenAPI spec
  // as a URL or as an uploaded file). Each group is checked independently.
  requireOneOf?: string[][];
  // Experimental built-ins are gated behind the Apps feature preview.
  preview?: boolean;
  // Types whose form is written by hand rather than rendered from `parameters`. The
  // parameter list is still the contract with the config: it says which fields the type
  // has, and the custom form supplies its own labels.
  customForm?: boolean;
  // What one item of the app's surface is called in the footer's receipt.
  surfaceNoun?: string;
  // Optional one-click demo that prefills the form.
  demo?: { label: string; name: string; parameters: Record<string, string> };
}

// In the order shown in the New grid, which is the order the empty state's map lists
// the protocols in (KajaMap.tsx): the dialog is opened from that screen, so a reader
// meets the same four in the same places. Keep in sync with the app types registered
// on the server (server/pkg/api/api.go).
export const appTypes: AppTypeDefinition[] = [
  {
    type: "grpc",
    label: "gRPC",
    description: "Call a gRPC service from its proto files or via server reflection.",
    icon: GrpcMark,
    // GrpcForm renders these: it reaches the server first and then offers what answered.
    customForm: true,
    surfaceNoun: "method",
    requireOneOf: [["protoDir", "reflection"]],
    parameters: [
      { key: "url", label: "URL", type: "url", placeholder: "dns:example.com:443" },
      { key: "protoDir", label: "Proto directory", type: "folder", placeholder: "path/to/proto", optional: true },
      { key: "reflection", label: "Use gRPC reflection", type: "boolean", optional: true },
      { key: "tls", label: "Transport", type: "text", optional: true },
      { key: "insecureSkipVerify", label: "Accept any certificate", type: "boolean", optional: true },
      { key: "caFile", label: "Certificate authority", type: "file", optional: true },
      { key: "clientCertFile", label: "Client certificate", type: "file", optional: true },
      { key: "clientKeyFile", label: "Client key", type: "file", optional: true },
      { key: "auth", label: "Authentication", type: "text", optional: true },
      { key: "token", label: "Token or API key", type: "text", optional: true },
      { key: "username", label: "Username", type: "text", optional: true },
      { key: "password", label: "Password", type: "text", optional: true },
      { key: "apiKeyName", label: "Metadata key", type: "text", optional: true },
    ],
    demo: {
      label: "try the grpcb.in demo server",
      name: "grpcb.in",
      parameters: { url: "grpcb.in:9000", reflection: "true" },
    },
  },
  {
    type: "openapi",
    label: "OpenAPI",
    description: "Call a REST API from its OpenAPI 3.x document.",
    icon: OpenApiMark,
    // OpenApiForm renders these: it reads the document first and then offers what it declares.
    customForm: true,
    surfaceNoun: "operation",
    requireOneOf: [["specUrl", "specContent"]],
    parameters: [
      { key: "specUrl", label: "OpenAPI document URL", type: "url", optional: true },
      { key: "specContent", label: "Uploaded OpenAPI document", type: "upload", optional: true },
      { key: "baseUrl", label: "Server", type: "url", optional: true },
      { key: "securityScheme", label: "Authentication", type: "text", optional: true },
      { key: "token", label: "Token or API key", type: "text", optional: true },
      { key: "username", label: "Username", type: "text", optional: true },
      { key: "password", label: "Password", type: "text", optional: true },
      { key: "specHeaderName", label: "Document header", type: "text", optional: true },
      { key: "specHeaderValue", label: "Document header value", type: "text", optional: true },
    ],
    demo: {
      label: "try the Petstore demo",
      name: "Petstore",
      parameters: { specUrl: "https://petstore3.swagger.io/api/v3/openapi.json" },
    },
  },
  {
    preview: true,
    type: "mcp",
    label: "MCP",
    description: "Explore another Model Context Protocol server: its tools, resources and prompts.",
    icon: McpMark,
    // McpForm renders these: it reads the server first and then shows what it exposes.
    customForm: true,
    surfaceNoun: "method",
    parameters: [
      { key: "url", label: "MCP endpoint", type: "url", placeholder: "https://example.com/mcp" },
      { key: "auth", label: "Authentication", type: "text", optional: true },
      { key: "token", label: "Token or API key", type: "text", optional: true },
      { key: "apiKeyName", label: "Header name", type: "text", optional: true },
    ],
    demo: {
      label: "try the DeepWiki demo server",
      name: "DeepWiki",
      parameters: { url: "https://mcp.deepwiki.com/mcp" },
    },
  },
  {
    type: "twirp",
    label: "Twirp",
    description: "Call a Twirp service from its proto files.",
    icon: TwirpMark,
    parameters: [
      {
        key: "url",
        label: "URL",
        type: "url",
        placeholder: "https://example.com/twirp",
        caption: "Base URL of the Twirp server.",
      },
      {
        key: "protoDir",
        label: "Proto directory",
        type: "folder",
        placeholder: "path/to/proto",
        caption: "Directory of .proto files (Twirp has no reflection).",
      },
    ],
  },
  {
    preview: true,
    // The config key stays "openai": it is what every kaja.json that has one already
    // says, and the app spoke only that API when it was written.
    type: "openai",
    label: "Chat",
    description: "Call a chat model over the OpenAI or the Claude API.",
    icon: Sparkles,
    // OpenAiForm renders these: which API it is decides the endpoint and the credential.
    customForm: true,
    surfaceNoun: "method",
    parameters: [
      { key: "api", label: "API", type: "text", optional: true },
      { key: "endpoint", label: "Endpoint", type: "url" },
      { key: "auth", label: "Authentication", type: "text", optional: true },
      { key: "token", label: "API key", type: "text", optional: true },
      { key: "apiKeyName", label: "Header name", type: "text", optional: true },
    ],
  },
  {
    preview: true,
    type: "folder",
    label: "Folder",
    description: "List, create, read and append to files in a folder on disk.",
    icon: FolderOpen,
    parameters: [
      {
        key: "path",
        label: "Folder",
        type: "folder",
        placeholder: "/path/to/folder",
        caption: "Absolute path on the machine serving the workspace.",
        picked: { placeholder: "No folder picked", caption: "Picking the folder is what grants Kaja access to it." },
      },
    ],
  },
];

export function getAppType(type: string): AppTypeDefinition | undefined {
  return appTypes.find((t) => t.type === type);
}

export function appTypeLabel(type: string): string {
  return getAppType(type)?.label ?? type;
}

// appType returns an app's type: the set field of its `app` oneof (e.g. "grpc").
export function appType(app: ConfigurationApp): string {
  return app.app.oneofKind ?? "";
}

function appVariant(app: ConfigurationApp): Record<string, unknown> | undefined {
  const kind = app.app.oneofKind;
  if (!kind) return undefined;
  return (app.app as Record<string, unknown>)[kind] as Record<string, unknown> | undefined;
}

// appParameters reads the fields the app's type declares into the string map the form
// works with. Booleans become "true"/"". Keys are the camelCase field names.
export function appParameters(app: ConfigurationApp): Record<string, string> {
  const variant = appVariant(app);
  const params: Record<string, string> = {};
  for (const parameter of getAppType(appType(app))?.parameters ?? []) {
    const value = variant?.[parameter.key];
    params[parameter.key] = typeof value === "boolean" ? (value ? "true" : "") : String(value ?? "");
  }
  return params;
}

// appHeaders reads the headers an app forwards upstream. They live inside the typed
// block (every type but the local Folder app has them).
export function appHeaders(app: ConfigurationApp): Record<string, string> {
  return (appVariant(app)?.headers as Record<string, string>) ?? {};
}

// APP_HEADER names the app a call belongs to. It is sent alongside the app's own
// headers and never reaches the wire: it is what the credential and transport security
// kaja holds for the app are looked up by, so a "${secret}" token is applied where it
// lives rather than handed to the browser to send.
export const APP_HEADER = "X-Kaja-App";

// HEADER_META_PREFIX is how a call's headers reach the Go side: the door reads them
// off the request under this prefix. The merge that produced them happens once, per
// call, in the client.
export const HEADER_META_PREFIX = "X-Header-";

// mergeHeaders lays one set of headers over another, matching names without regard to
// case: a header written for one call replaces the app's own rather than arriving
// beside it, which is what an `Authorization` typed for one request has to do. The
// same rule the credential is merged under server-side (apps.MergeMetadata).
export function mergeHeaders(headers: Record<string, string>, overrides?: Record<string, string>): Record<string, string> {
  if (!overrides || Object.keys(overrides).length === 0) return { ...headers };
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!Object.keys(overrides).some((override) => override.toLowerCase() === name.toLowerCase())) {
      merged[name] = value;
    }
  }
  return { ...merged, ...overrides };
}

// transportHeaders is what a call actually sends: the headers it was made with, plus
// the reserved one naming its app. `appHeaders` stays what the app is configured with,
// and the call's own merged set is what the Headers view shows.
export function transportHeaders(app: ConfigurationApp, requestHeaders: Record<string, string>): Record<string, string> {
  return { ...requestHeaders, [APP_HEADER]: app.name };
}

// isAppHeader says whether a name is the reserved one. A script setting it would send
// its call to another app's credential, so the call refuses rather than dropping it.
export function isAppHeader(name: string): boolean {
  return name.toLowerCase() === APP_HEADER.toLowerCase();
}

// Only the local Folder app does not.
export function typeForwardsHeaders(type: string): boolean {
  return type !== "folder";
}

// buildApp constructs a ConfigurationApp from the generic form state: the typed block
// for `type` with the declared params (coercing booleans) and, for types that forward
// them, the headers.
export function buildApp(name: string, type: string, params: Record<string, string>, headers: Record<string, string>): ConfigurationApp {
  const variant: Record<string, unknown> = {};
  for (const parameter of getAppType(type)?.parameters ?? []) {
    const value = params[parameter.key] ?? "";
    variant[parameter.key] = parameter.type === "boolean" ? value === "true" : value;
  }
  if (typeForwardsHeaders(type)) {
    variant.headers = { ...headers };
  }
  return {
    name,
    app: { oneofKind: type, [type]: variant } as unknown as ConfigurationApp["app"],
  };
}
