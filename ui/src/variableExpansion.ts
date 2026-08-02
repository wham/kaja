// ${NAME} variable references in app configuration values. Expansion itself
// happens outside the browser - in OpenApp for an app's creation parameters, and
// at the request hop for its headers - because a variable's value may be one
// this machine holds outside kaja.json and the browser is never handed it. What
// is left here reads the references: which names a value mentions, and what the
// configuration says a name is.
//
// The configured variables are kept in a module-level registry (synced from the
// loaded configuration in App.tsx) so editor completions can read them without
// threading the configuration through every call site.

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

// variableReferences returns the names referenced as ${NAME} in a value.
export function variableReferences(value: string): string[] {
  return Array.from(value.matchAll(VARIABLE_REFERENCE), (match) => match[1]);
}

// A variable's value either is the value, or names the source that holds it
// outside kaja.json.
export const SECRET_SOURCE = "${secret}";

const ENVIRONMENT_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type VariableKind = "value" | "stored" | "environment";

// variableKind classifies what a variable's configured value says: a value of
// its own, the machine's store, or the environment.
export function variableKind(value: string): VariableKind {
  if (value.trim() === SECRET_SOURCE) return "stored";
  if (environmentReferences(value).length > 0) return "environment";
  return "value";
}

// environmentReferences returns the environment variable names a value reads,
// which may sit inside a longer value ("https://${env:HOST}/v1").
export function environmentReferences(value: string): string[] {
  return Array.from(value.matchAll(ENVIRONMENT_REFERENCE), (match) => match[1]);
}

// storedEnvName is the environment variable a stored variable falls back to, so
// the same kaja.json works on a machine with no keychain. Mirrors the server.
export function storedEnvName(name: string): string {
  return "KAJA_" + name;
}

// variableNameError rejects a name that ${NAME} could never reference.
export function variableNameError(name: string): string | undefined {
  if (!VARIABLE_NAME.test(name)) {
    return "Use letters, numbers and underscores. Must not start with a number.";
  }
  return undefined;
}

// variableValueError rejects a value that can never resolve. The store is keyed
// by the variable's own name, so ${secret} has nothing to say inside a longer
// value.
export function variableValueError(value: string): string | undefined {
  if (value.includes(SECRET_SOURCE) && value.trim() !== SECRET_SOURCE) {
    return `${SECRET_SOURCE} must be the whole value.`;
  }
  return undefined;
}
