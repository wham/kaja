import { runtimeNames } from "./scriptBindings";
import ts from "typescript";

/**
 * The parameters a script takes, in the order it reads them.
 *
 * `kaja://run/<script>?key=value` leaves the whole query to the script, so the
 * only thing that knows which keys a script takes is the script — and the only
 * thing that knows what a name in it means is the compiler. So this reads the
 * AST rather than the text: `kaja` is an ordinary local binding, and a key is
 * written four ways that a pattern over the source would either miss or invent.
 * `kaja.input["a key"]`, `const { url: link } = kaja.input` and an alias one
 * line up are all reads of a parameter; a property called `input` on something
 * else entirely is not, and a `kaja.input` in a comment or a string is not.
 *
 * A key the script computes (`kaja.input[whichever]`) is left out rather than
 * guessed at: the sheet lists what the script names, and a value nothing named
 * can still be typed into the link by hand.
 */
export function readInputKeys(code: string): string[] {
  const file = ts.createSourceFile("script.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  // A file mid-edit may not have written the import yet, and the runtime is
  // spelled `kaja` everywhere it isn't aliased.
  const runtime = runtimeNames(file);
  const receivers = runtime.size > 0 ? runtime : new Set(["kaja"]);
  const aliases = inputAliases(file, receivers);

  const isInput = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    return ts.isPropertyAccessExpression(node) && node.name.text === "input" && ts.isIdentifier(node.expression) && receivers.has(node.expression.text);
  };

  const keys = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && isInput(node.expression)) {
      keys.add(node.name.text);
    } else if (ts.isElementAccessExpression(node) && isInput(node.expression)) {
      const literal = stringLiteral(node.argumentExpression);
      if (literal !== undefined) keys.add(literal);
    } else if (ts.isVariableDeclaration(node) && node.initializer && isInput(node.initializer) && ts.isObjectBindingPattern(node.name)) {
      for (const key of boundKeys(node.name)) keys.add(key);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);

  return [...keys];
}

// Names bound to the input map itself (`const input = kaja.input`), so the
// reads a line later are reads of a parameter.
function inputAliases(file: ts.SourceFile, receivers: Set<string>): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === "input" &&
      ts.isIdentifier(node.initializer.expression) &&
      receivers.has(node.initializer.expression.text)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return aliases;
}

// The keys a destructuring reads. A rename (`{ url: link }`) is a read of
// `url`, which is the name the link has to carry.
function boundKeys(pattern: ts.ObjectBindingPattern): string[] {
  const keys: string[] = [];
  for (const element of pattern.elements) {
    // `...rest` names no key.
    if (element.dotDotDotToken) continue;
    if (element.propertyName) {
      const literal = ts.isComputedPropertyName(element.propertyName)
        ? stringLiteral(element.propertyName.expression)
        : ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
          ? element.propertyName.text
          : undefined;
      if (literal !== undefined) keys.push(literal);
    } else if (ts.isIdentifier(element.name)) {
      keys.push(element.name.text);
    }
  }
  return keys;
}

function stringLiteral(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}
