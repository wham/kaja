import { parse } from "@babel/parser";
import type { File, Node } from "@babel/types";

/**
 * A script's syntax tree, or undefined where the code doesn't parse — which, in an
 * editor, is any file mid-keystroke. What is wrong with it is Monaco's to say; the
 * readers here have nothing to report about a file they cannot read.
 */
export function parseScript(code: string): File | undefined {
  try {
    return parse(code, {
      sourceType: "module",
      plugins: ["typescript"],
      errorRecovery: true,
      // The runner's async wrapper honours one, which is what lets the run report
      // correct a script that returned its answer rather than drawing it.
      allowReturnOutsideFunction: true,
      attachComment: false,
    });
  } catch {
    return undefined;
  }
}

/**
 * Every node under `node`, in source order. Babel keeps no parent pointers, so each
 * is handed the node it was reached from; returning false skips its children.
 */
export function walk(node: Node, visit: (node: Node, parent: Node | undefined) => void | false, parent?: Node): void {
  if (visit(node, parent) === false) return;
  for (const child of children(node)) walk(child, visit, node);
}

export function nodePath(file: File, offset: number): Node[] {
  const path: Node[] = [];
  let current: Node | undefined = file.program;
  while (current) {
    path.push(current);
    current = children(current).findLast((child) => child.start! <= offset && offset <= child.end!);
  }
  return path;
}

// The order Babel assigns a node's fields in is not always the order they are written
// in, so children are sorted by where they start.
function children(node: Node): Node[] {
  const found: Node[] = [];
  for (const key in node) {
    if (key === "comments" || key === "loc" || key === "extra") continue;
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) found.push(item);
    } else if (isNode(value)) {
      found.push(value);
    }
  }
  return found.sort((a, b) => a.start! - b.start!);
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === "object" && typeof (value as Node).type === "string";
}

export function literalText(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? undefined;
  return undefined;
}

/**
 * `object.name`, optional chain included: Babel spells `a?.b` as a node of its own
 * where TypeScript spelled it as the same access with a flag on it.
 */
export function memberAccess(node: Node | null | undefined): { object: Node; name: string } | undefined {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) return undefined;
  if (node.computed || node.property.type !== "Identifier") return undefined;
  return { object: node.object, name: node.property.name };
}

export function isCall(node: Node): node is Extract<Node, { type: "CallExpression" | "OptionalCallExpression" }> {
  return node.type === "CallExpression" || node.type === "OptionalCallExpression";
}

export function keyName(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return String(node.value);
  return undefined;
}
