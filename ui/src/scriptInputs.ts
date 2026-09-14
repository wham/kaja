import { runtimeNames } from "./scriptBindings";
import { baseName } from "./scriptLink";
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
 * can still be typed into the link by hand. What that costs is stated rather
 * than hidden — such a script is `open`, and what it names is then not all it
 * reads, so nothing checking a caller against it may refuse a key.
 */

export interface ScriptParameters {
  /** The keys it names, in the order it reads them. */
  keys: string[];
  /**
   * Whether it also reads keys it doesn't name — a computed key, the rest of a
   * destructuring, or the map handed somewhere whole. Such a script takes more
   * than it names, so nothing may be refused for it.
   */
  open: boolean;
}

export function readInputKeys(code: string): string[] {
  return readInputParameters(code).keys;
}

export function readInputParameters(code: string): ScriptParameters {
  // Parents, because what a read of the map *is* is a question about where it sits:
  // the object of a property access is a key, and the argument of a call is the whole
  // map going somewhere this cannot follow.
  const file = ts.createSourceFile("script.ts", code, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
  // A file mid-edit may not have written the import yet, and the runtime is
  // spelled `kaja` everywhere it isn't aliased.
  const runtime = runtimeNames(file);
  const receivers = runtime.size > 0 ? runtime : new Set(["kaja"]);
  const aliases = inputAliases(file, receivers);

  const isInput = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return aliases.has(node.text) && isReference(node);
    return ts.isPropertyAccessExpression(node) && node.name.text === "input" && ts.isIdentifier(node.expression) && receivers.has(node.expression.text);
  };

  const keys = new Set<string>();
  let open = false;
  const visit = (node: ts.Node) => {
    if (isInput(node)) {
      const read = readThrough(node);
      for (const key of read.keys) keys.add(key);
      open = open || read.open;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);

  return { keys: [...keys], open };
}

// What a reference to the input map reads, read off where the reference sits. A
// place this doesn't recognise is the map going somewhere whole, which names no key
// and leaves the script open.
function readThrough(node: ts.Node): ScriptParameters {
  const parent = node.parent;
  if (!parent) return { keys: [], open: true };
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return { keys: [parent.name.text], open: false };
  if (ts.isElementAccessExpression(parent) && parent.expression === node) {
    const literal = stringLiteral(parent.argumentExpression);
    return literal === undefined ? { keys: [], open: true } : { keys: [literal], open: false };
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    // A name bound to the map itself, whose own uses are read where they are written.
    if (ts.isIdentifier(parent.name)) return { keys: [], open: false };
    if (ts.isObjectBindingPattern(parent.name)) {
      return { keys: boundKeys(parent.name), open: parent.name.elements.some((element) => element.dotDotDotToken !== undefined) };
    }
  }
  return { keys: [], open: true };
}

// Whether an identifier is being read rather than declared. The name in
// `const input = kaja.input` is spelled like a use of the map and is the opposite of
// one, and reading it as the map going somewhere would leave every aliasing script
// open.
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) return parent.name !== node;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent)) return false;
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isMethodDeclaration(parent)) {
    return parent.name !== node;
  }
  return true;
}

// Names bound to the input map itself (`const input = kaja.input`), so the
// reads a line later are reads of a parameter. A name bound to one of those is one
// too, so the set is grown until it stops growing.
function inputAliases(file: ts.SourceFile, receivers: Set<string>): Set<string> {
  const aliases = new Set<string>();
  const isMap = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    return ts.isPropertyAccessExpression(node) && node.name.text === "input" && ts.isIdentifier(node.expression) && receivers.has(node.expression.text);
  };
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isMap(node.initializer) && !aliases.has(node.name.text)) {
        aliases.add(node.name.text);
        grew = true;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
  }
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

/**
 * A script as the editor is told about it: the name a `kaja.run` reaches it by, and
 * what reading the file said it takes.
 */
export interface ScriptInputs {
  /** The name a link spells the script with: no extension, folders kept. */
  name: string;
  /** What the file takes, or undefined where nothing has read the file yet. */
  parameters?: ScriptParameters;
}

/**
 * What every script in the workspace takes, written as TypeScript so the editor
 * checks a `kaja.run`'s parameters itself.
 *
 * A destination is a name rather than a handle, so the compiler has nothing to
 * resolve it against — this is that missing half, one entry per spelling a click
 * resolves, and `kaja.run`'s own declaration reads the parameters back out of it
 * (kajaModule). Nothing here is a second checker: what is refused is refused by the
 * same excess-property rule that refuses a misspelled field in a request.
 *
 * Two answers are deliberately open. A script nothing has read yet has no entry, so
 * a window that has just started refuses nothing rather than refusing everything;
 * and a script reading a key it doesn't name (`ScriptParameters.open`) takes
 * anything, because what it names is then not the whole truth.
 */
export function runInputDeclaration(scripts: ScriptInputs[]): string {
  // The script a spelling reaches is the first in the listing that answers to it,
  // which is what a click resolves to (findLinkedScript).
  const owner = new Map<string, string>();
  for (const script of scripts) {
    for (const spelling of linkSpellings(script.name)) {
      if (!owner.has(spelling)) owner.set(spelling, script.name);
    }
  }

  const entries: string[] = [];
  for (const script of scripts) {
    if (!script.parameters) continue;
    entries.push(`  ${quoted(script.name)}: ${parameterType(script.parameters)};`);
    for (const spelling of linkSpellings(script.name)) {
      if (spelling !== script.name && owner.get(spelling) === script.name) {
        entries.push(`  ${quoted(spelling)}: KajaScripts[${quoted(script.name)}];`);
      }
    }
  }

  return `// Generated from the scripts folder: what each script reads as kaja.input. The rule
// that reads it back is KajaRunInput, declared beside kaja.run itself.

// What a script that reads no parameters takes: none. Named rather than written as
// \`never\`, because TypeScript prints the name and the name is the whole message.
type ThisScriptReadsNoParameters = { readonly none: never };

interface KajaScripts {
${entries.join("\n")}${entries.length > 0 ? "\n" : ""}}
`;
}

// Every name a link reaches a script by: its own, with and without the extension a
// link may still be written with, and its base name where no earlier script claims it.
function linkSpellings(name: string): string[] {
  const spellings = [name, `${name}.ts`];
  const base = baseName(name);
  if (base !== name) spellings.push(base, `${base}.ts`);
  return spellings;
}

// A value is `unknown` because every one is sent as text (kaja.run stringifies it),
// so there is nothing about a value to be wrong. The key is the whole of what this
// checks, which is the whole of what reading the file can honestly say.
function parameterType(parameters: ScriptParameters): string {
  const named = parameters.keys.map((key) => `${propertyName(key)}?: unknown`);
  if (parameters.open) return `{ ${[...named, "[key: string]: unknown"].join("; ")} }`;
  // A script that reads nothing takes nothing, and an empty object type would accept
  // every key rather than none. The type is named rather than written as `never`
  // because TypeScript prints the name, which is what makes the refusal a sentence.
  if (named.length === 0) return "{ [key: string]: ThisScriptReadsNoParameters }";
  return `{ ${named.join("; ")} }`;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : quoted(key);
}

function quoted(text: string): string {
  return JSON.stringify(text);
}
