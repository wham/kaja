import type { File } from "@babel/types";

/**
 * What a script's imports bound, which is the only thing that says what a name
 * in the body means. `kaja` and a service are both ordinary local bindings, so
 * a receiver is identified by what brought it into the file rather than by how
 * it is spelled.
 */

/** Every name the file imported, whatever it imported it from. */
export function importedNames(file: File): Set<string> {
  return boundNames(file, () => true);
}

// Whatever the kaja runtime was bound to in this file, alias included — Monaco's
// auto-import can write the relative form of the module.
export function runtimeNames(file: File): Set<string> {
  return boundNames(file, (path) => path === "kaja" || path === "./kaja");
}

function boundNames(file: File, wanted: (modulePath: string) => boolean): Set<string> {
  const names = new Set<string>();
  for (const statement of file.program.body) {
    if (statement.type !== "ImportDeclaration" || !wanted(statement.source.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier") names.add(specifier.local.name);
    }
  }
  return names;
}
