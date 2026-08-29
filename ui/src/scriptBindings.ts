import ts from "typescript";
import { REST_DOOR } from "./restDoor";

/**
 * What a script's imports bound, which is the only thing that says what a name
 * in the body means. `kaja` and a service are both ordinary local bindings, so
 * a receiver is identified by what brought it into the file rather than by how
 * it is spelled.
 */

/**
 * Whatever the REST door was bound to in this file — `api`, and whatever each import
 * renamed it to. Matched on what was exported rather than on how it is spelled, since
 * the generated code reads it under the app's own name.
 */
export function doorNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === REST_DOOR) names.add(element.name.text);
    }
  }
  return names;
}

/** Every name the file imported, whatever it imported it from. */
export function importedNames(file: ts.SourceFile): Set<string> {
  return boundNames(file, () => true);
}

// Whatever the kaja runtime was bound to in this file, alias included — Monaco's
// auto-import can write the relative form of the module.
export function runtimeNames(file: ts.SourceFile): Set<string> {
  return boundNames(file, (path) => path === "kaja" || path === "./kaja");
}

function boundNames(file: ts.SourceFile, wanted: (modulePath: string) => boolean): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !wanted(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}
