import { appParameters, appType } from "./appTypes";
import { ConfigurationApp } from "./server/api";
import { variableReferences } from "./variableExpansion";

// Headers are excluded: they are forwarded per request, not a creation parameter.
export function appNeedsRecompile(a: ConfigurationApp, b: ConfigurationApp): boolean {
  return appType(a) !== appType(b) || JSON.stringify(appParameters(a)) !== JSON.stringify(appParameters(b));
}

// Parameters are expanded when the app is opened, so a changed ${NAME} forces a recompile too.
export function appReferencesChangedVariable(app: ConfigurationApp, previous: { [key: string]: string }, next: { [key: string]: string }): boolean {
  return Object.values(appParameters(app)).some((value) => variableReferences(value).some((name) => previous[name] !== next[name]));
}

/**
 * What a configuration write renamed, as old name to new. A name that left the file and
 * a name that arrived in it describing the same server are one app under two names —
 * there is nothing else in the file to say so, since an app is addressed by its name.
 * An app whose parameters also moved is a different app: it has to be reopened, so
 * following the rename into a script would point it at a surface nothing has compiled.
 */
export function detectAppRenames(
  previous: ConfigurationApp[],
  next: ConfigurationApp[],
  previousVariables: { [key: string]: string },
  nextVariables: { [key: string]: string },
): Map<string, string> {
  const previousByName = new Map(previous.map((app) => [app.name, app]));
  const nextByName = new Map(next.map((app) => [app.name, app]));

  const orphans = previous.filter((app) => !nextByName.has(app.name));
  const renames = new Map<string, string>();

  for (const newcomer of next) {
    if (previousByName.has(newcomer.name)) continue;
    const index = orphans.findIndex(
      (orphan) => !appNeedsRecompile(orphan, newcomer) && !appReferencesChangedVariable(newcomer, previousVariables, nextVariables),
    );
    if (index === -1) continue;
    renames.set(orphans[index].name, newcomer.name);
    orphans.splice(index, 1);
  }

  return renames;
}

/**
 * Whether the modules a script can import moved — an app added, removed, renamed, or
 * reopened against different parameters. TypeScript caches a module resolution and
 * never revalidates a file whose own text did not change, so a dangling import stays
 * green and a resolved one stays red until the editors holding them are poked.
 */
export function appModulesMoved(
  previous: ConfigurationApp[],
  next: ConfigurationApp[],
  previousVariables: { [key: string]: string },
  nextVariables: { [key: string]: string },
): boolean {
  if (previous.length !== next.length) return true;
  const previousByName = new Map(previous.map((app) => [app.name, app]));
  return next.some((app) => {
    const before = previousByName.get(app.name);
    return before === undefined || appNeedsRecompile(before, app) || appReferencesChangedVariable(app, previousVariables, nextVariables);
  });
}
