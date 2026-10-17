import { fetchHost, fetchKey } from "./fetchCall";
import { SUBJECT_FIELDS } from "./loopKey";
import type { Node, ObjectExpression, ObjectProperty } from "@babel/types";
import { importedNames, runtimeNames } from "./scriptBindings";
import { isCall, keyName, literalText, memberAccess, parseScript, walk } from "./scriptSyntax";

// A request small enough to read at a glance is described by its values, which is
// usually where two explorations of the same call differ. A bigger one stays quiet
// rather than picking an arbitrary field out of a crowd.
const SMALL_REQUEST_FIELDS = 3;
const MAX_SUBJECT = 24;

// A call a draft makes, in source order.
export interface DraftCall {
  service: string;
  method: string;
  // The first literal bound to an identifying field, if the call fills one in.
  subject?: string;
}

// Receivers are matched against what the file imports, so `console.log` and friends
// are never mistaken for a service call. A file that doesn't parse makes none.
export function readCalls(code: string): DraftCall[] {
  const file = parseScript(code);
  if (!file) return [];
  const imported = importedNames(file);
  const runtime = runtimeNames(file);
  const calls: DraftCall[] = [];

  walk(file.program, (node) => {
    if (!isCall(node)) return;
    const fetched = fetchCall(node.callee, node.arguments);
    if (fetched) {
      calls.push(fetched);
      return;
    }
    const callee = memberAccess(node.callee);
    if (!callee || callee.object.type !== "Identifier") return;
    const service = callee.object.name;
    // The kaja runtime is imported like a service and called like one, but
    // `kaja.table(...)` is the script drawing rather than a call it made — a script that
    // only draws would otherwise be titled `text +3`.
    if (runtime.has(service)) return;
    // With no imports to check against (a hand-written script), fall back to the shape a
    // service call has: a capitalized receiver.
    if (imported.size > 0 ? imported.has(service) : /^[A-Z]/.test(service)) {
      calls.push({ service, method: callee.name, subject: subjectOf(node.arguments[0]) });
    }
  });

  return calls;
}

/**
 * An HTTP call the script makes itself. `fetch` is the one spelling of it — the bare
 * global inside a script body is Kaja's own — so a draft that only fetches is named the
 * way its row in the log is: the verb and the host, with the path as the qualifier.
 *
 * A URL this cannot read — built out of variables, or not a URL at all — names
 * nothing rather than being guessed at, on the same rule a request's subject is.
 */
function fetchCall(callee: Node, args: Node[]): DraftCall | undefined {
  if (callee.type !== "Identifier" || callee.name !== "fetch") return undefined;

  const url = urlText(args[0]);
  if (url === undefined) return undefined;
  const host = fetchHost(url);
  if (host === url) return undefined;
  return { service: "fetch", method: `${methodText(args[1])} ${host}`, subject: fetchKey(url) };
}

// The literal part of the address. A template's head is enough for the host, which is
// the half of the title that has to be right.
function urlText(argument: Node | undefined): string | undefined {
  if (argument?.type === "TemplateLiteral") return argument.quasis[0].value.cooked ?? undefined;
  return literalText(argument);
}

// A verb written as anything but a literal is not one this can read, and GET is what
// fetch does when nothing says otherwise.
function methodText(argument: Node | undefined): string {
  if (argument?.type !== "ObjectExpression") return "GET";
  for (const property of properties(argument)) {
    if (keyName(property.key) !== "method") continue;
    const value = literalText(property.value);
    if (value !== undefined) return value.toUpperCase();
  }
  return "GET";
}

// The generated request only ever holds zero values, so an empty string, a 0 or a
// false is the absence of an answer rather than one worth showing.
function subjectOf(argument: Node | undefined): string | undefined {
  if (argument?.type !== "ObjectExpression") return undefined;

  for (const pattern of SUBJECT_FIELDS) {
    const found = findLiteral(argument, pattern, 0);
    if (found) return found;
  }
  const filled = filledValues(argument);
  return filled ? truncate(filled.join(", ")) : undefined;
}

// The `name: value` properties of an object, which is all a request literal is made of:
// a shorthand, a spread or a method is something else.
function properties(object: ObjectExpression): ObjectProperty[] {
  return object.properties.filter((property): property is ObjectProperty => property.type === "ObjectProperty" && !property.shorthand && !property.computed);
}

// Undefined for anything bigger or nested, so a large body never gets a title made of
// whichever field happened to come first.
function filledValues(object: ObjectExpression): string[] | undefined {
  if (object.properties.length === 0 || object.properties.length > SMALL_REQUEST_FIELDS) return undefined;
  if (properties(object).length !== object.properties.length) return undefined;

  const values: string[] = [];
  for (const { value } of properties(object)) {
    if (value.type === "StringLiteral") {
      if (!isZeroText(value.value)) values.push(value.value);
    } else if (value.type === "NumericLiteral") {
      if (value.value !== 0) values.push(String(value.value));
    } else if (value.type === "BooleanLiteral") {
      if (value.value) values.push("true");
    } else {
      // An object, an array, an expression: not a request you can read at a glance.
      return undefined;
    }
  }
  return values.length > 0 ? values : undefined;
}

function findLiteral(object: ObjectExpression, pattern: RegExp, depth: number): string | undefined {
  for (const property of properties(object)) {
    const name = property.key.type === "Identifier" || property.key.type === "StringLiteral" ? keyName(property.key) : undefined;
    const value = property.value;

    if (name && pattern.test(name)) {
      if (value.type === "StringLiteral" && !isZeroText(value.value)) return truncate(value.value);
      if (value.type === "NumericLiteral" && value.value !== 0) return String(value.value);
    }
    if (depth < 2 && value.type === "ObjectExpression") {
      const nested = findLiteral(value, pattern, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

// A 64-bit field is generated as a string, so its zero value is the text "0" rather
// than the number — without this a request nobody has filled in is titled `Sum · 0, 0`.
function isZeroText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || /^-?0+$/.test(trimmed);
}

function truncate(value: string): string {
  return value.length > MAX_SUBJECT ? value.slice(0, MAX_SUBJECT - 1) + "…" : value;
}

/**
 * The title is one string wherever it is stored, but a row can dim the part that only
 * qualifies it. That is what tells a draft apart from the method of the same name a
 * few rows below it in the tree — and the dimming is the whole of what says so, so the
 * separator is dropped rather than drawn as a bullet nobody can read a meaning into.
 */
export function titleParts(title: string): { name: string; qualifier?: string } {
  const at = title.indexOf(" · ");
  return at === -1 ? { name: title } : { name: title.slice(0, at), qualifier: title.slice(at + 3) };
}

/**
 * The title as one line, for the places that draw it without dimming anything — the
 * finder, the command row's trigger, the window. The qualifier is still there; only
 * the separator the split takes it apart on is spent.
 */
export function draftTitleText(title: string): string {
  const { name, qualifier } = titleParts(title);
  return qualifier ? `${name} ${qualifier}` : name;
}

/**
 * The filename a script is proposed under. Naming a script and saving it are the same
 * act, so the derived title decides it. `taken` settles collisions, which saving the
 * whole pile at once produces even where saving one at a time wouldn't.
 */
export function proposeFileName(title: string, taken: Iterable<string> = []): string {
  const word =
    title
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")[0] || "draft";
  const base = word.charAt(0).toLowerCase() + word.slice(1);
  const used = new Set([...taken].map((name) => name.replace(/\.ts$/, "").toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// Each disambiguated against what is on disk and against the ones named before it, so
// the list the confirm shows is the list that gets written.
export function proposeFileNames(titles: string[], taken: Iterable<string> = []): string[] {
  const used = [...taken];
  return titles.map((title) => {
    const name = proposeFileName(title, used);
    used.push(name);
    return name;
  });
}

/**
 * What a draft is called, read from the code it holds. Undefined when it calls
 * nothing yet — the caller falls back to a plain "Draft".
 *
 * The content is typed code against a known schema, so the title is a formatting job
 * rather than a summarization one, and it comes out the same every time.
 */
export function deriveDraftTitle(code: string): string | undefined {
  const calls = readCalls(code);
  if (calls.length === 0) return undefined;

  // Calling one method three times is still about that one method.
  const distinct: DraftCall[] = [];
  for (const call of calls) {
    if (!distinct.some((other) => other.service === call.service && other.method === call.method)) distinct.push(call);
  }

  if (distinct.length === 1) {
    const [only] = distinct;
    const subject = only.subject ?? calls.find((call) => call.subject)?.subject;
    return subject ? `${only.method} · ${subject}` : only.method;
  }
  if (distinct.length === 2) {
    return `${distinct[0].method} → ${distinct[1].method}`;
  }
  return `${distinct[0].method} +${distinct.length - 1}`;
}
