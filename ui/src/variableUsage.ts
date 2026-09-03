import { Script } from "./apps";
import { appHeaders, appParameters } from "./appTypes";
import { ScriptReference } from "./scriptFiles";
import { ConfigurationApp } from "./server/api";
import { variableReferences } from "./variableExpansion";

// Where a variable is used, which the Variables screen answers in two halves. An
// app's references are in the configuration the window already holds, so they are
// read here; a script's are read off disk by the scan, because a folder is not
// something the browser has.

export interface VariableUse {
  app: string;
  // What in the app names it: the creation parameter's own key ("baseUrl"), or
  // "header" for one of the per-request headers.
  field: string;
}

export function appVariableUses(apps: ConfigurationApp[]): Map<string, VariableUse[]> {
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

export function pluralCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
