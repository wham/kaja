import * as monaco from "monaco-editor";

// Monaco resolves JSON diagnostics globally, so the app form's schema is
// registered once rather than whenever an editor opens.

export const APP_CONFIG_JSON_URI = monaco.Uri.file("/app-config.json");

// An app is { name, <type>: { ...params, headers } }, so the variant key is
// open-ended; validate only the stable part and require a name.
const appJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
  required: ["name"],
  additionalProperties: true,
};

monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  schemas: [{ uri: "http://kaja/app-schema.json", fileMatch: [APP_CONFIG_JSON_URI.toString()], schema: appJsonSchema }],
});
