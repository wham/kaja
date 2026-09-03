import { fetchHost, fetchKey } from "./fetchCall";
import { SUBJECT_FIELDS } from "./loopKey";
import { importedNames, runtimeNames } from "./scriptBindings";
import ts from "typescript";

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
// are never mistaken for a service call.
export function readCalls(code: string): DraftCall[] {
  const file = ts.createSourceFile("draft.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  const imported = importedNames(file);
  const runtime = runtimeNames(file);
  const calls: DraftCall[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const fetched = fetchCall(node);
      if (fetched) {
        calls.push(fetched);
        ts.forEachChild(node, visit);
        return;
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const service = node.expression.expression.text;
      // The kaja runtime is imported like a service and called like one, but
      // `kaja.table(...)` is the script drawing rather than a call it made — a script that
      // only draws would otherwise be titled `text +3`.
      if (runtime.has(service)) {
        ts.forEachChild(node, visit);
        return;
      }
      // With no imports to check against (a hand-written script), fall back to the shape a
      // service call has: a capitalized receiver.
      if (imported.size > 0 ? imported.has(service) : /^[A-Z]/.test(service)) {
        calls.push({ service, method: node.expression.name.text, subject: subjectOf(node.arguments[0]) });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);

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
function fetchCall(node: ts.CallExpression): DraftCall | undefined {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "fetch") return undefined;

  const url = urlText(node.arguments[0]);
  if (url === undefined) return undefined;
  const host = fetchHost(url);
  if (host === url) return undefined;
  return { service: "fetch", method: `${methodText(node.arguments[1])} ${host}`, subject: fetchKey(url) };
}

// The literal part of the address. A template's head is enough for the host, which is
// the half of the title that has to be right.
function urlText(argument: ts.Expression | undefined): string | undefined {
  if (!argument) return undefined;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  if (ts.isTemplateExpression(argument)) return argument.head.text;
  return undefined;
}

// A verb written as anything but a literal is not one this can read, and GET is what
// fetch does when nothing says otherwise.
function methodText(argument: ts.Expression | undefined): string {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return "GET";
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.getText === undefined) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (name !== "method") continue;
    const value = property.initializer;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text.toUpperCase();
  }
  return "GET";
}

// The generated request only ever holds zero values, so an empty string, a 0 or a
// false is the absence of an answer rather than one worth showing.
function subjectOf(argument: ts.Expression | undefined): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;

  for (const pattern of SUBJECT_FIELDS) {
    const found = findLiteral(argument, pattern, 0);
    if (found) return found;
  }
  const filled = filledValues(argument);
  return filled ? truncate(filled.join(", ")) : undefined;
}

// Undefined for anything bigger or nested, so a large body never gets a title made of
// whichever field happened to come first.
function filledValues(object: ts.ObjectLiteralExpression): string[] | undefined {
  if (object.properties.length === 0 || object.properties.length > SMALL_REQUEST_FIELDS) return undefined;

  const values: string[] = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const value = property.initializer;
    if (ts.isStringLiteral(value)) {
      if (!isZeroText(value.text)) values.push(value.text);
    } else if (ts.isNumericLiteral(value)) {
      if (Number(value.text) !== 0) values.push(value.text);
    } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
      values.push("true");
    } else if (value.kind !== ts.SyntaxKind.FalseKeyword) {
      // An object, an array, an expression: not a request you can read at a glance.
      return undefined;
    }
  }
  return values.length > 0 ? values : undefined;
}

function findLiteral(object: ts.ObjectLiteralExpression, pattern: RegExp, depth: number): string | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    const value = property.initializer;

    if (name && pattern.test(name)) {
      if (ts.isStringLiteral(value) && !isZeroText(value.text)) return truncate(value.text);
      if (ts.isNumericLiteral(value) && Number(value.text) !== 0) return value.text;
    }
    if (depth < 2 && ts.isObjectLiteralExpression(value)) {
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
