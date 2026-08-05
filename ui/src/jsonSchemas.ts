import * as monaco from "monaco-editor";

// Monaco resolves JSON diagnostics globally, so every JSON editor in the app
// registers its schema here against its own model URI. Registering them apart
// would not work: setDiagnosticsOptions replaces the whole list, so the last
// editor to load would be the only one validated.

export const APP_CONFIG_JSON_URI = monaco.Uri.file("/app-config.json");
export const VARIABLES_JSON_URI = monaco.Uri.file("/variables.json");

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

// The variables block is a flat map of names to values.
const variablesJsonSchema = {
  type: "object",
  additionalProperties: { type: "string" },
};

monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  schemas: [
    { uri: "http://kaja/app-schema.json", fileMatch: [APP_CONFIG_JSON_URI.toString()], schema: appJsonSchema },
    { uri: "http://kaja/variables-schema.json", fileMatch: [VARIABLES_JSON_URI.toString()], schema: variablesJsonSchema },
  ],
});
