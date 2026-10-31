// ${NAME} variable references in app configuration values. Expansion itself
// happens outside the browser - in OpenApp for an app's creation parameters, and
// at the request hop for its headers - because a variable's value may be one
// this machine holds outside kaja.json and the browser is never handed it. What
// is left here reads the references: which names a value mentions, and what the
// workspace says a name is.
//
// The configured variables are kept in a module-level registry (synced from the
// loaded workspace in App.tsx) so editor completions can read them without
// threading the workspace through every call site.

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
// A sign-in Kaja keeps for the app naming the variable as its credential. It is
// written by signing in, never typed, and its token is never a value.
export const SIGN_IN_SOURCE = "${signin}";

const ENVIRONMENT_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type VariableKind = "value" | "stored" | "signIn" | "environment";

// variableKind classifies what a variable's configured value says: a value of
// its own, the machine's store, or the environment.
export function variableKind(value: string): VariableKind {
  if (value.trim() === SECRET_SOURCE) return "stored";
  if (value.trim() === SIGN_IN_SOURCE) return "signIn";
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
  for (const source of [SECRET_SOURCE, SIGN_IN_SOURCE]) {
    if (value.includes(source) && value.trim() !== source) {
      return `${source} must be the whole value.`;
    }
  }
  return undefined;
}

const WHOLE_REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

// signInCredential is what an app's credential is while it signs in: "${NAME}", NAME
// being the variable the sign-in is kept in. A credential already naming one keeps it,
// so signing in again replaces that sign-in; otherwise the variable is named after the
// app, numbered past a name that already holds something else.
export function signInCredential(credential: string, appName: string, variables: { [key: string]: string }): string {
  const named = WHOLE_REFERENCE.exec(credential.trim())?.[1];
  if (named && (!(named in variables) || variables[named].trim() === SIGN_IN_SOURCE)) return "${" + named + "}";

  const base =
    (appName
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "APP") + "_SIGNIN";
  const prefixed = /^[0-9]/.test(base) ? "_" + base : base;
  for (let n = 1; ; n++) {
    const name = n === 1 ? prefixed : `${prefixed}_${n}`;
    if (!(name in variables)) return "${" + name + "}";
  }
}

// kajaTokenVariable is the variable Kaja's own MCP token is stored under: one already
// stored there is the same token being stored again, and a name holding anything else
// is numbered past.
export function kajaTokenVariable(variables: { [key: string]: string }): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? "KAJA_MCP_TOKEN" : `KAJA_MCP_TOKEN_${n}`;
    if (!(name in variables) || variables[name].trim() === SECRET_SOURCE) return name;
  }
}

// signsIn reports whether a credential names a variable holding a sign-in.
export function signsIn(credential: string, variables: { [key: string]: string }): boolean {
  const named = WHOLE_REFERENCE.exec(credential.trim())?.[1];
  return Boolean(named && variables[named]?.trim() === SIGN_IN_SOURCE);
}
