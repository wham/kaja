import { Script } from "./apps";
import { appHeaders, appParameters } from "./appTypes";
import { ScriptReference } from "./scriptFiles";
import { VariableSource, VariableStatus, WorkspaceApp } from "./server/api";
import { pluralCount } from "./plural";
import { variableReferences } from "./variableExpansion";

// Where a variable is used, which the Variables screen answers in two halves. An
// app's references are in the workspace the window already holds, so they are
// read here; a script's are read off disk by the scan, because a folder is not
// something the browser has.

export interface VariableUse {
  app: string;
  // What in the app names it: the creation parameter's own key ("baseUrl"), or
  // "header" for one of the per-request headers.
  field: string;
}

export function appVariableUses(apps: WorkspaceApp[]): Map<string, VariableUse[]> {
  const uses = new Map<string, VariableUse[]>();
  const add = (name: string, use: VariableUse) => {
    const existing = uses.get(name);
    if (existing) existing.push(use);
    else uses.set(name, [use]);
  };

  for (const app of apps) {
    // An app naming a variable twice in one field is one use of it, so a row is
    // keyed on the app and the field rather than on each occurrence.
    const seen = new Set<string>();
    const fields: [string, string][] = [
      ...Object.entries(appParameters(app)),
      ...Object.values(appHeaders(app)).map((value): [string, string] => ["header", value]),
    ];
    for (const [field, value] of fields) {
      for (const name of variableReferences(value)) {
        const key = `${name} ${field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        add(name, { app: app.name, field });
      }
    }
  }
  return uses;
}

/**
 * A variable an app uses that has nothing behind it here, so the reference goes out as
 * written. kaja.json is shared and a keychain is not, so a workspace synced from another
 * machine names a value this one never held, and nothing about the file says so.
 */
export interface MissingVariable {
  name: string;
  // Whether kaja.json names it at all. One it names is missing a value; one it doesn't
  // is missing its definition, which is a different fix on the same screen.
  defined: boolean;
  apps: string[];
}

export function missingVariables(variables: { [key: string]: string }, status: VariableStatus[], uses: Map<string, VariableUse[]>): MissingVariable[] {
  // Read off a status that is present rather than one that is absent, so a workspace
  // whose statuses haven't arrived yet doesn't flash every variable as missing.
  const unset = new Set(status.filter((entry) => entry.source === VariableSource.UNSET).map((entry) => entry.name));
  const missing: MissingVariable[] = [];
  for (const [name, appUses] of uses) {
    const defined = name in variables;
    if (defined && !unset.has(name)) continue;
    missing.push({ name, defined, apps: [...new Set(appUses.map((use) => use.app))] });
  }
  return missing.sort((a, b) => a.name.localeCompare(b.name));
}

export function missingByApp(missing: MissingVariable[]): Map<string, MissingVariable[]> {
  const byApp = new Map<string, MissingVariable[]>();
  for (const variable of missing) {
    for (const app of variable.apps) {
      const existing = byApp.get(app);
      if (existing) existing.push(variable);
      else byApp.set(app, [variable]);
    }
  }
  return byApp;
}

export function missingVariableSentence(variable: Pick<MissingVariable, "name" | "defined">): string {
  return variable.defined ? `\${${variable.name}} has no value on this machine` : `\${${variable.name}} isn't defined`;
}

/**
 * How a scanned reference is named in the popover: the script's path within the
 * scripts folder. The scan reports the absolute path a listing reports, so a file
 * the sidebar knows is named the way the sidebar names it, and one it doesn't is
 * named by its own last segment rather than by a path nobody asked to see.
 */
export function scriptReferenceLabel(reference: ScriptReference, scripts: Script[]): string {
  const script = scripts.find((candidate) => candidate.path === reference.path);
  if (script) return script.folder ? `${script.folder}/${script.name}` : script.name;
  const separator = Math.max(reference.path.lastIndexOf("/"), reference.path.lastIndexOf("\\"));
  return separator === -1 ? reference.path : reference.path.slice(separator + 1);
}

/** Most-referenced first, then by name, so the popover's order is not the walk's. */
export function orderReferences(references: ScriptReference[], scripts: Script[]): ScriptReference[] {
  return [...references].sort((a, b) => b.count - a.count || scriptReferenceLabel(a, scripts).localeCompare(scriptReferenceLabel(b, scripts)));
}

/**
 * How long ago the scan ran, said coarsely. The popover is the only thing that
 * asks, and it asks as it opens, so there is no clock to keep.
 */
export function scannedAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "Scanned just now";
  if (minutes < 60) return `Scanned ${pluralCount(minutes, "minute")} ago`;
  return `Scanned ${pluralCount(Math.floor(minutes / 60), "hour")} ago`;
}
