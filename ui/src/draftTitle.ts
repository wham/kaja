import { SUBJECT_FIELDS } from "./loopKey";
import { importedNames, runtimeNames } from "./scriptBindings";
import ts from "typescript";

// A request small enough to read at a glance is described by its values, which
// is usually where two explorations of the same call differ. A bigger one stays
// quiet rather than picking an arbitrary field out of a crowd.
const SMALL_REQUEST_FIELDS = 3;
const MAX_SUBJECT = 24;

// A call a draft makes, in source order.
export interface DraftCall {
  service: string;
  method: string;
  // The first literal bound to an identifying field, if the call fills one in.
  subject?: string;
}

// The calls a draft makes. Receivers are matched against what the file
// imports, so `console.log` and friends are never mistaken for a service call.
export function readCalls(code: string): DraftCall[] {
  const file = ts.createSourceFile("draft.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  const imported = importedNames(file);
  const runtime = runtimeNames(file);
  const calls: DraftCall[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const service = node.expression.expression.text;
      // The kaja runtime is imported like a service and called like one, but
      // `kaja.table(...)` is the script drawing rather than a call it made — a
      // script that only draws would otherwise be titled `text +3`.
      if (runtime.has(service)) {
        ts.forEachChild(node, visit);
        return;
      }
      // With no imports to check against (a hand-written script), fall back to
      // the shape a service call has: a capitalized receiver.
      if (imported.size > 0 ? imported.has(service) : /^[A-Z]/.test(service)) {
        calls.push({ service, method: node.expression.name.text, subject: subjectOf(node.arguments[0]) });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);

  return calls;
}

// The generated request only ever holds zero values, so an empty string, a 0 or
// a false is the absence of an answer rather than one worth showing.
function subjectOf(argument: ts.Expression | undefined): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;

  for (const pattern of SUBJECT_FIELDS) {
    const found = findLiteral(argument, pattern, 0);
    if (found) return found;
  }
  const filled = filledValues(argument);
  return filled ? truncate(filled.join(", ")) : undefined;
}

// The values of a small, all-scalar request that have actually been filled in.
// Undefined for anything bigger or nested, so a large body never gets a title
// made of whichever field happened to come first.
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

// A 64-bit field is generated as a string, so its zero value is the text "0"
// rather than the number — without this a request nobody has filled in gets
// titled `Sum · 0, 0`.
function isZeroText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || /^-?0+$/.test(trimmed);
}

function truncate(value: string): string {
  return value.length > MAX_SUBJECT ? value.slice(0, MAX_SUBJECT - 1) + "…" : value;
}

/**
 * What a draft is called, read from the code it holds. Undefined when it
 * calls nothing yet — the caller falls back to a plain "Draft".
 *
 * This is why Kaja can name these better than a chat app names conversations:
 * the content is typed code against a known schema, so the title is a
 * formatting job rather than a summarization one, and it comes out the same
 * every time.
 */
/**
 * The title is one string wherever it is stored, but a row can dim the part that
 * only qualifies it. That is what tells an unsaved script apart from the method
 * of the same name a few rows below it in the tree.
 */
export function titleParts(title: string): { name: string; qualifier?: string } {
  const at = title.indexOf(" · ");
  return at === -1 ? { name: title } : { name: title.slice(0, at), qualifier: title.slice(at + 1) };
}

/**
 * The filename a script is proposed under. Naming a script and saving it are the
 * same act, so the derived title decides it and the section converges on one
 * convention. `taken` settles collisions, which saving the whole pile at once
 * produces even where saving one at a time wouldn't.
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

// Names a whole pile at once, each one disambiguated against what is on disk and
// against the ones named before it — so the list the confirm shows is the list
// that gets written.
export function proposeFileNames(titles: string[], taken: Iterable<string> = []): string[] {
  const used = [...taken];
  return titles.map((title) => {
    const name = proposeFileName(title, used);
    used.push(name);
    return name;
  });
}

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
