import { Blocks, Globe, FolderOpen, Plug, Server, Sparkles, type LucideIcon } from "lucide-react";
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

// In the order shown in the New grid. Keep in sync with the app types registered on
// the server (server/pkg/api/api.go).
export const appTypes: AppTypeDefinition[] = [
  {
    type: "grpc",
    label: "gRPC",
    description: "Call a gRPC service from its proto files or via server reflection.",
    icon: Server,
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
    type: "twirp",
    label: "Twirp",
    description: "Call a Twirp service from its proto files.",
    icon: Plug,
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
    type: "openapi",
    label: "OpenAPI",
    description: "Call a REST API from its OpenAPI 3.x document.",
    icon: Globe,
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
    icon: Blocks,
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
        placeholder: "/path/to/notes",
        caption: "Methods list, create, read and append to files in this folder. On the desktop, pick the folder to grant access.",
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

// APP_HEADER names the app a call belongs to. Both transports send it alongside the
// app's own headers and neither lets it reach the wire: it is what the credential and
// transport security kaja holds for the app are looked up by, so a "${secret}" token
// is applied where it lives rather than handed to the browser to send.
export const APP_HEADER = "X-Kaja-App";

// transportHeaders is what a call actually sends. `appHeaders` stays what the Headers
// view shows, which is the configuration and nothing kaja added to route the call.
export function transportHeaders(app: ConfigurationApp): Record<string, string> {
  return { ...appHeaders(app), [APP_HEADER]: app.name };
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
