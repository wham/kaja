import { GlobeIcon, Icon, MarkdownIcon, PlugIcon, ServerIcon, SparkleFillIcon } from "./components/icons";
import { ConfigurationApp } from "./server/api";

// Parameter kinds an app exposes in the New form. "file" and "folder" render a
// native picker on the desktop (and a plain text field everywhere else);
// "boolean" renders a checkbox; "upload" reads a chosen file's text content into
// the parameter value (works on both web and desktop).
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

export interface AppTypeDefinition {
  type: string;
  label: string;
  description: string;
  icon: Icon;
  parameters: AppParameterDefinition[];
  // Groups of parameter keys where at least one must be provided (e.g. an OpenAPI
  // spec supplied as a URL or as an uploaded file). Each group is checked
  // independently.
  requireOneOf?: string[][];
  // Experimental built-ins are gated behind the Apps feature preview. gRPC/Twirp
  // are always available.
  preview?: boolean;
  // Optional one-click demo that prefills the form.
  demo?: { label: string; name: string; parameters: Record<string, string> };
}

// The app types, in the order shown in the New grid. Keep in sync with the app
// types registered on the server (server/pkg/api/api.go).
export const appTypes: AppTypeDefinition[] = [
  {
    type: "grpc",
    label: "gRPC",
    description: "Call a gRPC service from its proto files or via server reflection.",
    icon: ServerIcon,
    parameters: [
      {
        key: "url",
        label: "URL",
        type: "url",
        placeholder: "dns:example.com:443",
        caption: "Address of the gRPC server.",
      },
      {
        key: "protoDir",
        label: "Proto directory",
        type: "folder",
        placeholder: "path/to/proto",
        caption: "Directory of .proto files. Leave empty to discover services via reflection.",
        optional: true,
      },
      {
        key: "reflection",
        label: "Use gRPC reflection",
        type: "boolean",
        caption: "Discover services automatically from the server instead of local proto files.",
        optional: true,
      },
    ],
    demo: {
      label: "Try the grpcb.in demo server",
      name: "grpcb.in",
      parameters: { url: "grpcb.in:9000", reflection: "true" },
    },
  },
  {
    type: "twirp",
    label: "Twirp",
    description: "Call a Twirp service from its proto files.",
    icon: PlugIcon,
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
    type: "openapi",
    label: "OpenAPI",
    description: "Call a REST API from its OpenAPI 3.x document.",
    icon: GlobeIcon,
    requireOneOf: [["specUrl", "specContent"]],
    parameters: [
      {
        key: "specUrl",
        label: "OpenAPI spec URL",
        type: "url",
        optional: true,
        placeholder: "https://petstore3.swagger.io/api/v3/openapi.json",
        caption:
          "The OpenAPI 3.x document is converted into a service you can call like a gRPC or Twirp app. Credentials below are used to fetch it, so a spec behind a login can be read.",
      },
      {
        key: "specContent",
        label: "Or upload a spec file",
        type: "upload",
        optional: true,
        caption: "Upload an OpenAPI 3.x document (JSON or YAML). Set the base URL below, or the spec must declare an absolute server URL.",
      },
      {
        key: "baseUrl",
        label: "Base URL",
        type: "url",
        optional: true,
        placeholder: "https://api.example.com/v3",
        caption: "Overrides the upstream base URL from the spec's servers list. Requests are sent here, with each operation's path appended.",
      },
      {
        key: "token",
        label: "API token or key",
        type: "text",
        optional: true,
        placeholder: "Token or API key",
        caption: "Sent per the spec's security scheme: as a Bearer token, or as the named API key header/query/cookie. Also used to fetch the spec URL.",
      },
      {
        key: "username",
        label: "Username",
        type: "text",
        optional: true,
        placeholder: "For HTTP Basic auth",
        caption: "Only for APIs that use HTTP Basic authentication.",
      },
      {
        key: "password",
        label: "Password",
        type: "text",
        optional: true,
        placeholder: "For HTTP Basic auth",
      },
    ],
    demo: {
      label: "Try the Swagger Petstore demo",
      name: "Petstore",
      parameters: { specUrl: "https://petstore3.swagger.io/api/v3/openapi.json" },
    },
  },
  {
    preview: true,
    type: "openai",
    label: "OpenAI",
    description: "Call the standard OpenAI chat completions API.",
    icon: SparkleFillIcon,
    parameters: [
      {
        key: "endpoint",
        label: "Chat completions endpoint",
        type: "url",
        placeholder: "https://api.openai.com/v1/chat/completions",
        caption: "Full URL of the chat completions endpoint. Requests are POSTed directly to it.",
      },
      {
        key: "token",
        label: "API token",
        type: "text",
        placeholder: "sk-...",
        caption: "Sent as a Bearer token in the Authorization header of each request.",
      },
    ],
    demo: {
      label: "Use the OpenAI endpoint",
      name: "OpenAI",
      parameters: { endpoint: "https://api.openai.com/v1/chat/completions" },
    },
  },
  {
    preview: true,
    type: "markdown",
    label: "Markdown",
    description: "Create and write Markdown files in a folder on disk.",
    icon: MarkdownIcon,
    parameters: [
      {
        key: "folder",
        label: "Markdown folder",
        type: "folder",
        placeholder: "/path/to/notes",
        caption: "Methods create and write Markdown files in this folder. On the desktop, pick the folder to grant access.",
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

// appParameters reads the fields the app's type declares into the string map the
// form works with. Booleans become "true"/"". Keys are the (camelCase) field names
// declared in appTypes.
export function appParameters(app: ConfigurationApp): Record<string, string> {
  const variant = appVariant(app);
  const params: Record<string, string> = {};
  for (const parameter of getAppType(appType(app))?.parameters ?? []) {
    const value = variant?.[parameter.key];
    params[parameter.key] = typeof value === "boolean" ? (value ? "true" : "") : String(value ?? "");
  }
  return params;
}

// appHeaders reads the headers an app forwards to its upstream. They live inside
// the typed block (every type but the local Markdown app has them).
export function appHeaders(app: ConfigurationApp): Record<string, string> {
  return (appVariant(app)?.headers as Record<string, string>) ?? {};
}

// typeForwardsHeaders reports whether an app type sends request headers upstream;
// only the local Markdown app does not.
function typeForwardsHeaders(type: string): boolean {
  return type !== "markdown";
}

// buildApp constructs a ConfigurationApp from the generic form state: it sets the
// typed block for `type` with the declared params (coercing booleans) and, for
// types that forward them, the headers.
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
