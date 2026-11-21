import { FieldInfo, IMessageType } from "@protobuf-ts/runtime";
import type { CallExpression, Expression, Node, ObjectExpression, ObjectProperty, OptionalCallExpression } from "@babel/types";
import { App } from "./apps";
import { isCall, keyName, parseScript, walk } from "./scriptSyntax";
import { resolveMethod } from "./valueCompletions";

/**
 * The values a script's requests write, as places to put the caret: what the phone's
 * bar steps through with Prev and Next, the way a form is filled in field by field.
 * Only a literal is a stop, at any depth, since what the script computes is not a
 * value to type over. A string's stop is inside its quotes, so what is typed replaces
 * the text and keeps the literal.
 */
export interface FieldStop {
  key: string;
  from: number;
  to: number;
}

export function fieldStops(code: string, apps: App[]): FieldStop[] {
  const file = parseScript(code);
  if (!file) return [];
  const stops: FieldStop[] = [];
  const visit = (object: ObjectExpression, message: IMessageType<any> | undefined) => {
    for (const property of object.properties) {
      if (property.type !== "ObjectProperty" || property.computed) continue;
      const key = keyName((property as ObjectProperty).key);
      if (key === undefined) continue;
      const field = message?.fields.find((candidate) => candidate.localName === key || candidate.name === key || candidate.jsonName === key);
      const value = unwrap(property.value as Node);
      if (value.type === "ObjectExpression") {
        if (!field || (field.kind === "message" && !field.repeat)) visit(value, field?.kind === "message" ? field.T() : undefined);
        continue;
      }
      const stop = stopOf(value, field);
      if (stop) stops.push({ key, ...stop });
    }
  };
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const resolved = resolveMethod(file, node as CallExpression | OptionalCallExpression, apps);
    const argument = node.arguments[0] as Node | undefined;
    const object = argument && unwrap(argument);
    if (resolved && object?.type === "ObjectExpression") visit(object, resolved.method.I);
  });
  return stops.sort((a, b) => a.from - b.from);
}

function stopOf(node: Node, field: FieldInfo | undefined): { from: number; to: number } | undefined {
  const from = node.start!;
  const to = node.end!;
  if (node.type === "StringLiteral" || (node.type === "TemplateLiteral" && node.expressions.length === 0)) return { from: from + 1, to: to - 1 };
  if (node.type === "NumericLiteral" || node.type === "BooleanLiteral") return { from, to };
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") return { from, to };
  // `State.OPEN`, the way an enum is written.
  const isEnum = field?.kind === "enum" && !field.repeat;
  if (isEnum && node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier")
    return { from, to };
  return undefined;
}

// `{ … } as Request` and the like are the literal they wrap.
function unwrap(node: Node): Node {
  let current = node;
  while (current.type === "TSAsExpression" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression") {
    current = (current as { expression: Expression }).expression;
  }
  return current;
}

export function stopAt(stops: FieldStop[], head: number): number | undefined {
  const index = stops.findIndex((stop) => stop.from <= head && head <= stop.to);
  return index < 0 ? undefined : index;
}

// The stop after the caret, or before it, counting from the one it is in.
export function hop(stops: FieldStop[], head: number, forward: boolean): number | undefined {
  const current = stopAt(stops, head);
  if (current !== undefined) {
    const next = current + (forward ? 1 : -1);
    return next >= 0 && next < stops.length ? next : undefined;
  }
  if (forward) {
    const next = stops.findIndex((stop) => stop.from > head);
    return next < 0 ? undefined : next;
  }
  const before = stops.findLastIndex((stop) => stop.to < head);
  return before < 0 ? undefined : before;
}
