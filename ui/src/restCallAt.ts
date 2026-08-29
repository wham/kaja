import ts from "typescript";
import { REST_DOOR } from "./restDoor";

/**
 * The REST call whose path string is under the cursor:
 * `theatre.get("/shows/{showId}", …)`.
 *
 * Read at the language level rather than by pattern, for the reason `scriptInputs`
 * is: the door is an ordinary local binding, so which receiver is the door is settled
 * by what the file imported and under what alias, and a `"/shows"` in a comment, in a
 * string, or in an argument to something else is not a call.
 *
 * The path is what is being hovered, so it is the string literal the position sits
 * inside — not the call the position sits anywhere in. That is what keeps the answer
 * to a hover over `{ showId: "/shows" }` empty.
 */
export interface RestCallAt {
  // The app the door was imported from, which is what the call is routed by.
  appSpecifier: string;
  verb: string;
  path: string;
  // Where the path literal sits, quotes included, so a hover can underline exactly it.
  start: number;
  end: number;
}

export function restCallAt(code: string, offset: number): RestCallAt | undefined {
  const file = ts.createSourceFile("hover.ts", code, ts.ScriptTarget.Latest, true);

  // A door is imported as `api`, usually under the app's own name. One file may hold
  // several, so the specifier is kept per binding rather than looked up again.
  const doors = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exported = element.propertyName?.text ?? element.name.text;
      if (exported === REST_DOOR) doors.set(element.name.text, statement.moduleSpecifier.text);
    }
  }
  if (doors.size === 0) return undefined;

  let found: RestCallAt | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const specifier = doors.get(node.expression.expression.text);
      const argument = node.arguments[0];
      if (specifier && argument && ts.isStringLiteral(argument) && offset >= argument.getStart(file) && offset <= argument.getEnd()) {
        found = {
          appSpecifier: specifier,
          verb: node.expression.name.text.toUpperCase(),
          path: argument.text,
          start: argument.getStart(file),
          end: argument.getEnd(),
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
