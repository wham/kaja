import { EnumInfo, FieldInfo, IMessageType, ScalarType } from "@protobuf-ts/runtime";
import type { CallExpression, Expression, File, Node, ObjectExpression, ObjectProperty, OptionalCallExpression } from "@babel/types";
import { importLines } from "./appLoader";
import { App } from "./apps";
import { readInstant } from "./cellTime";
import { declaredValues } from "./declarations";
import { defaultFieldValue, Imports } from "./defaultInput";
import { mergeImports } from "./drafts";
import { isCall, keyName, parseScript, walk } from "./scriptSyntax";
import { recallValues } from "./typeMemory";
import { resolveMethod } from "./valueCompletions";

/**
 * A request as the script writes it, read as fields: what a phone edits in place of the
 * object literal. The source is the truth throughout. Every edit is a splice of the one
 * value it changes, read off the AST, so whatever else the author wrote — formatting,
 * comments, an expression in the next field — is left exactly as it was.
 */

export interface Range {
  start: number;
  end: number;
}

export interface RequestCall {
  // `Issues.ListForRepo`, as the script names it.
  label: string;
  app: App;
  line: number;
  // Where the call is written, so it can be shown in the editor.
  start: number;
  inputType: IMessageType<any>;
  // The request literal, or undefined where the call is handed something else.
  object?: Range;
  // What the call is handed when it isn't a literal.
  argument?: Range;
}

export type RowValue =
  | ({ kind: "string"; value: string; quote: string } & Range)
  | ({ kind: "number"; text: string } & Range)
  | ({ kind: "boolean"; value: boolean } & Range)
  // `Enum.MEMBER`, or the number an enum is also written as.
  | ({ kind: "enum"; name?: string; number?: number; object?: string } & Range)
  | ({ kind: "object"; count: number } & Range)
  | ({ kind: "expression"; text: string } & Range);

export interface RequestRow {
  key: string;
  // The field the key fills in, or undefined where the message has no such field.
  field?: FieldInfo;
  // The message the field is on, for what earlier calls sent to it.
  typeName: string;
  method: string;
  value: RowValue;
  // The whole property, for removing it.
  property: Range;
  // The object it is a property of.
  object: Range;
}

export interface RequestLevel {
  call: RequestCall;
  object: Range;
  rows: RequestRow[];
  // The fields of the message nothing at this level sets yet, in declaration order.
  unset: FieldInfo[];
  // Where the last property ends, spread included, which is where one is added.
  lastProperty?: number;
}

export function readRequestCalls(code: string, apps: App[]): RequestCall[] {
  const file = parseScript(code);
  if (!file) return [];
  return requestCalls(file, code, apps).map(({ call }) => call);
}

function requestCalls(file: File, code: string, apps: App[]): { call: RequestCall; node: ObjectExpression | undefined }[] {
  const found: { call: RequestCall; node: ObjectExpression | undefined }[] = [];
  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const resolved = resolveMethod(file, node as CallExpression | OptionalCallExpression, apps);
    if (!resolved) return;
    const argument = node.arguments[0] as Node | undefined;
    const object = argument && unwrap(argument);
    found.push({
      call: {
        label: `${resolved.serviceName}.${resolved.method.name}`,
        app: resolved.app,
        line: node.loc?.start.line ?? lineOf(code, node.start!),
        start: node.start!,
        inputType: resolved.method.I,
        object: object?.type === "ObjectExpression" ? range(object) : undefined,
        argument: argument && object?.type !== "ObjectExpression" ? range(argument) : undefined,
      },
      node: object?.type === "ObjectExpression" ? object : undefined,
    });
  });
  return found;
}

/**
 * One level of a call's request: the properties written at `path`, each with the field
 * it fills in. Undefined where the path no longer leads to a literal, which is how a
 * level held open across an edit that removed it is let go of.
 */
export function readRequestLevel(code: string, apps: App[], callIndex: number, path: string[]): RequestLevel | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  const found = requestCalls(file, code, apps)[callIndex];
  if (!found?.node) return undefined;

  let object = found.node;
  let message: IMessageType<any> | undefined = found.call.inputType;
  for (const key of path) {
    const property = propertiesOf(object).find((candidate) => propertyKey(candidate) === key);
    const value = property && unwrap(property.value as Node);
    if (value?.type !== "ObjectExpression") return undefined;
    const field: FieldInfo | undefined = message && fieldNamed(message, key);
    message = field?.kind === "message" && !field.repeat ? field.T() : undefined;
    object = value;
  }

  const rows = rowsOf(object, message, code, found.call.label);
  const written = new Set(rows.map((row) => row.field?.localName ?? row.key));
  const unset = (message?.fields ?? []).filter((field) => !field.oneof && !written.has(field.localName));
  return { call: found.call, object: range(object), rows, unset, lastProperty: object.properties.at(-1)?.end ?? undefined };
}

/**
 * Every value in every request the script writes that a picker can change: the scalar
 * literals and the enum members, at any depth. What the editor underlines.
 */
export function editableRows(code: string, apps: App[]): RequestRow[] {
  const file = parseScript(code);
  if (!file) return [];
  const rows: RequestRow[] = [];
  const visit = (object: ObjectExpression, message: IMessageType<any> | undefined, method: string) => {
    for (const row of rowsOf(object, message, code, method)) {
      if (row.value.kind === "object") {
        const property = propertiesOf(object).find((candidate) => propertyKey(candidate) === row.key);
        const nested = property && unwrap(property.value as Node);
        const field = row.field;
        if (nested?.type === "ObjectExpression") visit(nested, field?.kind === "message" && !field.repeat ? field.T() : undefined, method);
      } else if (row.value.kind !== "expression") {
        rows.push(row);
      }
    }
  };
  for (const { call, node } of requestCalls(file, code, apps)) {
    if (node) visit(node, call.inputType, call.label);
  }
  return rows;
}

export function rowAt(code: string, apps: App[], offset: number): RequestRow | undefined {
  return editableRows(code, apps).find((row) => row.value.start <= offset && offset <= row.value.end);
}

function rowsOf(object: ObjectExpression, message: IMessageType<any> | undefined, code: string, method: string): RequestRow[] {
  return propertiesOf(object).flatMap((property): RequestRow[] => {
    const key = propertyKey(property);
    if (key === undefined) return [];
    const field = message && fieldNamed(message, key);
    return [
      {
        key,
        field,
        typeName: message?.typeName ?? "",
        method,
        value: readValue(unwrap(property.value as Node), field, code),
        property: range(property),
        object: range(object),
      },
    ];
  });
}

function readValue(node: Node, field: FieldInfo | undefined, code: string): RowValue {
  const at = range(node);
  const isEnum = field?.kind === "enum" && !field.repeat;
  if (node.type === "StringLiteral") return { kind: "string", value: node.value, quote: code[node.start!], ...at };
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return { kind: "string", value: node.quasis[0].value.cooked ?? "", quote: "`", ...at };
  if (node.type === "NumericLiteral" || (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral")) {
    const text = code.slice(node.start!, node.end!);
    if (isEnum) return { kind: "enum", number: Number(text), ...at };
    return { kind: "number", text, ...at };
  }
  if (node.type === "BooleanLiteral") return { kind: "boolean", value: node.value, ...at };
  if (isEnum && node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier") {
    return { kind: "enum", name: node.property.name, object: node.object.name, ...at };
  }
  if (node.type === "ObjectExpression" && (!field || (field.kind === "message" && !field.repeat))) {
    return { kind: "object", count: propertiesOf(node).length, ...at };
  }
  return { kind: "expression", text: code.slice(node.start!, node.end!), ...at };
}

export interface Choice {
  label: string;
  // The source text the choice writes.
  text: string;
  selected: boolean;
  // Said beside the label, e.g. the number an enum member is.
  note?: string;
}

/**
 * How a value is changed. A closed set is a list of choices; anything else is a field
 * of the value's own kind, with what earlier calls sent offered beside it.
 */
export type FieldControl =
  { kind: "choice"; choices: Choice[]; other?: TextControl } | TextControl | { kind: "instant"; date: Date; write: (date: Date) => string };

export interface TextControl {
  kind: "text" | "number";
  value: string;
  suggestions: string[];
  // The source text a typed value writes, or undefined where it can't be one.
  write: (value: string) => string | undefined;
}

export function controlFor(row: RequestRow, code: string): FieldControl | undefined {
  const { field, value } = row;

  if (value.kind === "boolean") {
    return { kind: "choice", choices: [true, false].map((choice) => ({ label: String(choice), text: String(choice), selected: value.value === choice })) };
  }

  if (value.kind === "enum") {
    const info = field?.kind === "enum" ? field.T() : undefined;
    if (!info) return undefined;
    const object = value.object ?? enumIdentifier(info, code);
    return {
      kind: "choice",
      choices: enumMembers(info).map(([name, number]) => ({
        label: name,
        text: object ? `${object}.${name}` : String(number),
        note: String(number),
        selected: value.name !== undefined ? value.name === name : value.number === number,
      })),
    };
  }

  const scalar = field?.kind === "scalar" ? field.T : undefined;
  const remembered = (current: string) =>
    field ? unique(recallValues(row.typeName, field.localName, scalar).map((remembered) => String(remembered.value))).filter((text) => text !== current) : [];

  if (value.kind === "number") {
    return {
      kind: "number",
      value: value.text,
      suggestions: remembered(value.text).filter((text) => isNumber(text)),
      write: (typed) => (isNumber(typed) ? String(Number(typed)) : undefined),
    };
  }

  if (value.kind === "string") {
    const writeString = (typed: string) => stringLiteral(typed, value.quote);
    // A 64-bit integer is written as a string, being past what a number holds.
    if (scalar !== undefined && isLongInteger(scalar)) {
      return {
        kind: "number",
        value: value.value,
        suggestions: remembered(value.value).filter((text) => isInteger(text)),
        write: (typed) => (isInteger(typed.trim()) ? writeString(typed.trim()) : undefined),
      };
    }
    const date = readInstant(value.value);
    if (date) return { kind: "instant", date, write: (picked) => writeString(instantText(picked, value.value)) };
    const declared = declaredValues(field);
    const text: TextControl = {
      kind: "text",
      value: value.value,
      suggestions: remembered(value.value).filter((text) => !declared.includes(text)),
      write: writeString,
    };
    if (declared.length > 0) {
      return {
        kind: "choice",
        choices: declared.map((choice) => ({ label: choice, text: writeString(choice), selected: choice === value.value })),
        other: text,
      };
    }
    return text;
  }

  return undefined;
}

// What a field is, as the row says it beside the key.
export function fieldType(field: FieldInfo | undefined): string | undefined {
  if (!field) return undefined;
  const base =
    field.kind === "scalar"
      ? scalarName(field.T)
      : field.kind === "enum"
        ? "enum"
        : field.kind === "map"
          ? "map"
          : field.T().typeName.slice(field.T().typeName.lastIndexOf(".") + 1);
  if (field.kind === "scalar" && declaredValues(field).length > 0) return "enum";
  return field.repeat ? `${base}[]` : base;
}

export function replaceValue(code: string, value: Range, text: string): string {
  return code.slice(0, value.start) + text + code.slice(value.end);
}

/**
 * Adds a field to a request literal at what a generated call would have written for it,
 * with any import the value needs, laid out the way the literal already is. The offset
 * is where the value landed, so a picker can be opened on it.
 */
export function addField(code: string, level: RequestLevel, field: FieldInfo): { code: string; offset: number } {
  const imports: Imports = {};
  const declared = field.repeat ? [] : declaredValues(field);
  // A field that takes one of a few words starts at one of them rather than at a blank it refuses.
  const value = declared.length > 0 ? JSON.stringify(declared[0]) : defaultFieldValue(field, level.call.app.sources, imports);
  const property = `${propertyName(field.localName)}: ${value}`;
  const { start, end } = level.object;
  const inner = code.slice(start + 1, end - 1);
  let edit: { at: number; to: number; text: string; valueAt: number };

  if (level.rows.length === 0 && inner.trim() === "") {
    const text = `{ ${property} }`;
    edit = { at: start, to: end, text, valueAt: start + 2 + property.length - value.length };
  } else {
    const last = level.lastProperty ?? level.object.start + 1;
    const comma = /^\s*,/.exec(code.slice(last, end - 1));
    const after = comma ? last + comma[0].length : last;
    const multiline = inner.includes("\n");
    if (multiline) {
      const indent = indentationAt(code, firstPropertyStart(level) ?? last);
      const text = `${comma ? "" : ","}\n${indent}${property}${comma ? "," : ""}`;
      edit = { at: after, to: after, text, valueAt: after + text.length - value.length - (comma ? 1 : 0) };
    } else {
      const text = comma ? ` ${property},` : `, ${property}`;
      edit = { at: after, to: after, text, valueAt: after + text.length - value.length - (comma ? 1 : 0) };
    }
  }

  const spliced = code.slice(0, edit.at) + edit.text + code.slice(edit.to);
  const lines = importLines(level.call.app, imports);
  if (lines.length === 0) return { code: spliced, offset: edit.valueAt };
  const merged = mergeImports(spliced, lines.join("\n") + "\n");
  // Imports land above the literal, so the value moved by what they added.
  return { code: merged, offset: edit.valueAt + merged.length - spliced.length };
}

/** Takes a property out of its literal along with the separator and line it owned. */
export function removeField(code: string, row: RequestRow): string {
  const { property, object } = row;
  const lineStart = code.lastIndexOf("\n", property.start - 1) + 1;
  const rest = /^[ \t]*,?[ \t]*\r?\n/.exec(code.slice(property.end));
  // On a line of its own, the line goes with it.
  if (code.slice(lineStart, property.start).trim() === "" && rest && lineStart > object.start) {
    return code.slice(0, lineStart) + code.slice(property.end + rest[0].length);
  }
  const following = /^\s*,\s*/.exec(code.slice(property.end));
  if (following && code[property.end + following[0].length] !== "}") {
    return code.slice(0, property.start) + code.slice(property.end + following[0].length);
  }
  const preceding = /,\s*$/.exec(code.slice(object.start + 1, property.start));
  const from = preceding ? property.start - preceding[0].length : property.start;
  const to = following ? property.end + following[0].trimEnd().length : property.end;
  const result = code.slice(0, from) + code.slice(to);
  return result.slice(0, object.start) + result.slice(object.start).replace(/^\{\s+\}/, "{}");
}

function firstPropertyStart(level: RequestLevel): number | undefined {
  return level.rows.length > 0 ? Math.min(...level.rows.map((row) => row.property.start)) : undefined;
}

function indentationAt(code: string, offset: number): string {
  const lineStart = code.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))![0];
}

function propertiesOf(object: ObjectExpression): ObjectProperty[] {
  return object.properties.filter((property): property is ObjectProperty => property.type === "ObjectProperty");
}

function propertyKey(property: ObjectProperty): string | undefined {
  return property.computed ? undefined : keyName(property.key);
}

function fieldNamed(message: IMessageType<any>, key: string): FieldInfo | undefined {
  return message.fields.find((candidate) => candidate.localName === key || candidate.name === key || candidate.jsonName === key);
}

// `{ … } as Request` and the like are the literal they wrap.
function unwrap(node: Node): Node {
  let current = node;
  while (current.type === "TSAsExpression" || current.type === "TSSatisfiesExpression" || current.type === "TSNonNullExpression") {
    current = (current as { expression: Expression }).expression;
  }
  return current;
}

function range(node: Node): Range {
  return { start: node.start!, end: node.end! };
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
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

// An instant written back the way the one it replaces was: whole seconds stay whole.
function instantText(date: Date, previous: string): string {
  const iso = date.toISOString();
  return /\.\d+/.test(previous) ? iso : iso.replace(/\.000Z$/, "Z");
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
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

function scalarName(type: ScalarType): string {
  return ScalarType[type].toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
