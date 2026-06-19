import { GlobeIcon, Icon, MarkdownIcon, SparkleFillIcon } from "@primer/octicons-react";

// Parameter kinds an app exposes in the New App form. "file" and "folder" render
// a native picker on the desktop (and a plain text field everywhere else).
export type AppParameterType = "text" | "url" | "file" | "folder";

export interface AppParameterDefinition {
  key: string;
  label: string;
  type: AppParameterType;
  placeholder?: string;
  caption?: string;
}

export interface AppTypeDefinition {
  type: string;
  label: string;
  description: string;
  icon: Icon;
  parameters: AppParameterDefinition[];
  // Optional one-click demo that prefills the form.
  demo?: { label: string; name: string; parameters: Record<string, string> };
}

// The built-in app types, in the order shown in the New App grid. Keep in sync
// with the app types registered on the server (server/pkg/api/api.go).
export const appTypes: AppTypeDefinition[] = [
  {
    type: "openapi",
    label: "OpenAPI",
    description: "Call a REST API from its OpenAPI 3.x document.",
    icon: GlobeIcon,
    parameters: [
      {
        key: "spec_url",
        label: "OpenAPI spec URL",
        type: "url",
        placeholder: "https://petstore3.swagger.io/api/v3/openapi.json",
        caption: "The OpenAPI 3.x document is converted into a service you can call like a gRPC or Twirp project.",
      },
    ],
    demo: {
      label: "Try the Swagger Petstore demo",
      name: "Petstore",
      parameters: { spec_url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    },
  },
  {
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
