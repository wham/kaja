import ts from "typescript";

// Fields whose value identifies the thing a call is about, so it is worth
// putting in the title. Ordered: an explicit id beats a name.
const SUBJECT_FIELDS = [/^id$/i, /_id$/i, /Id$/, /^slug$/i, /^key$/i, /^code$/i, /^name$/i, /^email$/i, /^title$/i];
const MAX_SUBJECT = 24;

// A call a scratch makes, in source order.
export interface ScratchCall {
  service: string;
  method: string;
  // The first literal bound to an identifying field, if the call fills one in.
  subject?: string;
}

// The calls a scratch makes. Receivers are matched against what the file
// imports, so `console.log` and friends are never mistaken for a service call.
export function readCalls(code: string): ScratchCall[] {
  const file = ts.createSourceFile("scratch.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  const imported = importedNames(file);
  const calls: ScratchCall[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const service = node.expression.expression.text;
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

function importedNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

// The generated request only ever holds zero values, so an empty string or a 0
// is the absence of an answer rather than one worth showing.
function subjectOf(argument: ts.Expression | undefined): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;

  for (const pattern of SUBJECT_FIELDS) {
    const found = findLiteral(argument, pattern, 0);
    if (found) return found;
  }
  return undefined;
}

function findLiteral(object: ts.ObjectLiteralExpression, pattern: RegExp, depth: number): string | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    const value = property.initializer;

    if (name && pattern.test(name)) {
      if (ts.isStringLiteral(value) && value.text.trim() !== "") return truncate(value.text);
      if (ts.isNumericLiteral(value) && Number(value.text) !== 0) return value.text;
    }
    if (depth < 2 && ts.isObjectLiteralExpression(value)) {
      const nested = findLiteral(value, pattern, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > MAX_SUBJECT ? value.slice(0, MAX_SUBJECT - 1) + "…" : value;
}

/**
 * What a scratch is called, read from the code it holds. Undefined when it
 * calls nothing yet — the caller falls back to a plain "Scratch".
 *
 * This is why Kaja can name these better than a chat app names conversations:
 * the content is typed code against a known schema, so the title is a
 * formatting job rather than a summarization one, and it comes out the same
 * every time.
 */
export function deriveScratchTitle(code: string): string | undefined {
  const calls = readCalls(code);
  if (calls.length === 0) return undefined;

  // Calling one method three times is still about that one method.
  const distinct: ScratchCall[] = [];
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
