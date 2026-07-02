// Expansion of ${NAME} variable references in app configuration values,
// mirroring the server-side expansion applied to creation parameters in OpenApp.
// The client expands the values it sends itself: the per-request headers.
//
// The configured variables are kept in a module-level registry (synced from the
// loaded configuration in App.tsx) so request-time code and editor completions
// can read them without threading the configuration through every call site.

const VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

let registry: { [key: string]: string } = {};

export function setVariables(variables: { [key: string]: string }): void {
  registry = { ...variables };
}

export function getVariables(): { [key: string]: string } {
  return registry;
}

// expandVariables replaces ${NAME} references with the given (or registered)
// variable values. References to undefined variables are left as-is so literal
// ${...} text still passes through.
export function expandVariables(value: string, variables: { [key: string]: string } = registry): string {
  return value.replace(VARIABLE_REFERENCE, (reference, name) => (name in variables ? variables[name] : reference));
}

// expandHeaders expands variable references in every header value.
export function expandHeaders(headers: { [key: string]: string }): { [key: string]: string } {
  const expanded: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(headers)) {
    expanded[key] = expandVariables(value);
  }
  return expanded;
}

// variableReferences returns the names referenced as ${NAME} in a value.
export function variableReferences(value: string): string[] {
  return Array.from(value.matchAll(VARIABLE_REFERENCE), (match) => match[1]);
}
