import { EnumInfo, FieldInfo, IMessageType, ScalarType } from "@protobuf-ts/runtime";
import type { CallExpression, Expression, Node, ObjectExpression, ObjectProperty, OptionalCallExpression } from "@babel/types";
import { App } from "./apps";
import { declaredValues } from "./declarations";
import { isCall, keyName, parseScript, walk } from "./scriptSyntax";
import { recallValues } from "./typeMemory";
import { resolveMethod } from "./valueCompletions";

/**
 * The values a script's requests send, as the phone edits them: each literal written
 * in a request, at any depth, with the field it fills in. The source stays the truth;
 * an edit is a splice of the one literal it changes, read off the AST, so everything
 * else the author wrote is left as it was. What the script computes is not a value.
 */

export type Literal =
  | { kind: "string"; value: string; quote: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; value: boolean }
  // `State.OPEN`, or the number an enum is also written as.
  | { kind: "enum"; name?: string; number?: number; object?: string };

export interface RequestValue {
  key: string;
  // The field the key fills in, or undefined where the message has no such field.
  field?: FieldInfo;
  // The message the field is on, for what earlier calls sent to it.
  typeName: string;
  literal: Literal;
  start: number;
  end: number;
  // Where the call sending it is written.
  call: number;
}

export function requestValues(code: string, apps: App[]): RequestValue[] {
  const file = parseScript(code);
  if (!file) return [];
  const values: RequestValue[] = [];
  const visit = (object: ObjectExpression, message: IMessageType<any> | undefined, call: number) => {
    for (const property of object.properties) {
      if (property.type !== "ObjectProperty" || property.computed) continue;
      const key = keyName((property as ObjectProperty).key);
      if (key === undefined) continue;
      const field = message?.fields.find((candidate) => candidate.localName === key || candidate.name === key || candidate.jsonName === key);
      const node = unwrap(property.value as Node);
      if (node.type === "ObjectExpression") {
        if (!field || (field.kind === "message" && !field.repeat)) visit(node, field?.kind === "message" ? field.T() : undefined, call);
        continue;
      }
      const literal = literalOf(node, field, code);
      if (literal) values.push({ key, field, typeName: message?.typeName ?? "", literal, start: node.start!, end: node.end!, call });
    }
  };
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const resolved = resolveMethod(file, node as CallExpression | OptionalCallExpression, apps);
    const argument = node.arguments[0] as Node | undefined;
    const object = argument && unwrap(argument);
    if (resolved && object?.type === "ObjectExpression") visit(object, resolved.method.I, node.start!);
  });
  return values.sort((a, b) => a.start - b.start);
}

function literalOf(node: Node, field: FieldInfo | undefined, code: string): Literal | undefined {
  const isEnum = field?.kind === "enum" && !field.repeat;
  if (node.type === "StringLiteral") return { kind: "string", value: node.value, quote: code[node.start!] };
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return { kind: "string", value: node.quasis[0].value.cooked ?? "", quote: "`" };
  if (node.type === "NumericLiteral" || (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral")) {
    const text = code.slice(node.start!, node.end!);
    return isEnum ? { kind: "enum", number: Number(text) } : { kind: "number", text };
  }
  if (node.type === "BooleanLiteral") return { kind: "boolean", value: node.value };
  if (isEnum && node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier") {
    return { kind: "enum", name: node.property.name, object: node.object.name };
  }
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

export interface Choice {
  label: string;
  // The source text the choice writes.
  text: string;
  selected: boolean;
}

export interface TextControl {
  kind: "text" | "number";
  value: string;
  // What earlier calls sent to the field, most recent first.
  suggestions: string[];
  // The source text a typed value writes, or undefined where it can't be one.
  write: (typed: string) => string | undefined;
}

/** A closed set is a list of choices; anything else is a field of the value's own kind. */
export type ValueControl = { kind: "choice"; choices: Choice[]; other?: TextControl } | TextControl;

export function controlFor(value: RequestValue, code: string): ValueControl | undefined {
  const { field, literal } = value;

  if (literal.kind === "boolean") {
    return { kind: "choice", choices: [true, false].map((choice) => ({ label: String(choice), text: String(choice), selected: literal.value === choice })) };
  }

  if (literal.kind === "enum") {
    const info = field?.kind === "enum" ? field.T() : undefined;
    if (!info) return undefined;
    const object = literal.object ?? enumIdentifier(info, code);
    return {
      kind: "choice",
      choices: enumMembers(info).map(([name, number]) => ({
        label: name,
        text: object ? `${object}.${name}` : String(number),
        selected: literal.name !== undefined ? literal.name === name : literal.number === number,
      })),
    };
  }

  const scalar = field?.kind === "scalar" ? field.T : undefined;
  const remembered = (current: string) =>
    field ? unique(recallValues(value.typeName, field.localName, scalar).map((recalled) => String(recalled.value))).filter((text) => text !== current) : [];

  if (literal.kind === "number") {
    return {
      kind: "number",
      value: literal.text,
      suggestions: remembered(literal.text).filter(isNumber),
      write: (typed) => (isNumber(typed) ? String(Number(typed)) : undefined),
    };
  }

  const writeString = (typed: string) => stringLiteral(typed, literal.quote);
  // A 64-bit integer is written as a string, being past what a number holds.
  if (scalar !== undefined && isLongInteger(scalar)) {
    return {
      kind: "number",
      value: literal.value,
      suggestions: remembered(literal.value).filter(isInteger),
      write: (typed) => (isInteger(typed.trim()) ? writeString(typed.trim()) : undefined),
    };
  }
  const declared = declaredValues(field);
  const text: TextControl = {
    kind: "text",
    value: literal.value,
    suggestions: remembered(literal.value).filter((suggestion) => !declared.includes(suggestion)),
    write: writeString,
  };
  if (declared.length === 0) return text;
  return { kind: "choice", choices: declared.map((choice) => ({ label: choice, text: writeString(choice), selected: choice === literal.value })), other: text };
}

function enumMembers(info: EnumInfo): [string, number][] {
  return Object.entries(info[1]).filter((entry): entry is [string, number] => typeof entry[1] === "number");
}

// The name the enum is imported under in this script, so a choice reads as the member
// rather than as its number.
function enumIdentifier(info: EnumInfo, code: string): string | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  const name = info[0].slice(info[0].lastIndexOf(".") + 1);
  for (const statement of file.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && keyName(specifier.imported) === name) return specifier.local.name;
    }
  }
  return undefined;
}

function stringLiteral(value: string, quote: string): string {
  if (quote === "`") return "`" + value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  const json = JSON.stringify(value);
  if (quote !== "'") return json;
  return "'" + json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'";
}

function isNumber(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

function isInteger(text: string): boolean {
  return /^-?\d+$/.test(text);
}

function isLongInteger(type: ScalarType): boolean {
  return [ScalarType.INT64, ScalarType.UINT64, ScalarType.FIXED64, ScalarType.SFIXED64, ScalarType.SINT64].includes(type);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
