import type { Expression, File, Identifier, Node, ObjectPattern } from "@babel/types";
import { runtimeNames } from "./scriptBindings";
import { baseName } from "./scriptLink";
import { literalText, memberAccess, parseScript, walk } from "./scriptSyntax";

/**
 * The parameters a script takes, in the order it reads them.
 *
 * `kaja://run/<script>?key=value` leaves the whole query to the script, so the
 * only thing that knows which keys a script takes is the script — and the only
 * thing that knows what a name in it means is its syntax. So this reads the
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

/** The keys the script names, or undefined where it doesn't parse. */
export function readInputKeys(code: string): string[] | undefined {
  return readInputParameters(code)?.keys;
}

export function readInputParameters(code: string): ScriptParameters | undefined {
  const file = parseScript(code);
  if (!file) return undefined;
  // A file mid-edit may not have written the import yet, and the runtime is
  // spelled `kaja` everywhere it isn't aliased.
  const runtime = runtimeNames(file);
  const receivers = runtime.size > 0 ? runtime : new Set(["kaja"]);
  const isInputMember = (node: Node): boolean => {
    const access = memberAccess(node);
    return access?.name === "input" && access.object.type === "Identifier" && receivers.has(access.object.name);
  };
  const aliases = inputAliases(file, isInputMember);
  const declared = declaredIdentifiers(file);

  const keys = new Set<string>();
  let open = false;
  walk(file.program, (node, parent) => {
    const isInput = node.type === "Identifier" ? aliases.has(node.name) && isReference(node, parent, declared) : isInputMember(node);
    if (!isInput) return;
    const read = readThrough(node, parent);
    for (const key of read.keys) keys.add(key);
    open = open || read.open;
  });

  return { keys: [...keys], open };
}

// What a reference to the input map reads, read off where the reference sits. A
// place this doesn't recognise is the map going somewhere whole, which names no key
// and leaves the script open.
function readThrough(node: Node, parent: Node | undefined): ScriptParameters {
  if (!parent) return { keys: [], open: true };
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && parent.object === node) {
    if (!parent.computed && parent.property.type === "Identifier") return { keys: [parent.property.name], open: false };
    const literal = literalText(parent.property);
    return literal === undefined ? { keys: [], open: true } : { keys: [literal], open: false };
  }
  if (parent.type === "VariableDeclarator" && parent.init === node) {
    // A name bound to the map itself, whose own uses are read where they are written.
    if (parent.id.type === "Identifier") return { keys: [], open: false };
    if (parent.id.type === "ObjectPattern") {
      return { keys: boundKeys(parent.id), open: parent.id.properties.some((property) => property.type === "RestElement") };
    }
  }
  return { keys: [], open: true };
}

// Whether an identifier is being read rather than declared or used as a name. The name
// in `const input = kaja.input` is spelled like a use of the map and is the opposite of
// one, and reading it as the map going somewhere would leave every aliasing script open.
function isReference(node: Identifier, parent: Node | undefined, declared: Set<Node>): boolean {
  if (!parent || declared.has(node)) return false;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.computed || parent.property !== node;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassProperty":
    case "ClassMethod":
    case "TSPropertySignature":
      return parent.computed || parent.key !== node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return false;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
  }
  return true;
}

// Every identifier a declaration binds: a variable, a parameter, a caught error, and
// whatever a destructuring of any of them names.
function declaredIdentifiers(file: File): Set<Node> {
  const declared = new Set<Node>();
  const bind = (pattern: Node | null | undefined): void => {
    if (!pattern) return;
    switch (pattern.type) {
      case "Identifier":
        declared.add(pattern);
        break;
      case "ObjectPattern":
        for (const property of pattern.properties) bind(property.type === "RestElement" ? property.argument : property.value);
        break;
      case "ArrayPattern":
        for (const element of pattern.elements) bind(element);
        break;
      case "RestElement":
        bind(pattern.argument);
        break;
      case "AssignmentPattern":
        bind(pattern.left);
        break;
      case "TSParameterProperty":
        bind(pattern.parameter);
        break;
    }
  };
  walk(file.program, (node) => {
    if (node.type === "VariableDeclarator") bind(node.id);
    else if (node.type === "CatchClause") bind(node.param);
    else if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod"
    ) {
      for (const param of node.params) bind(param);
    }
  });
  return declared;
}

// Names bound to the input map itself (`const input = kaja.input`), so the
// reads a line later are reads of a parameter. A name bound to one of those is one
// too, so the set is grown until it stops growing.
function inputAliases(file: File, isInputMember: (node: Node) => boolean): Set<string> {
  const aliases = new Set<string>();
  const isMap = (node: Expression): boolean => (node.type === "Identifier" ? aliases.has(node.name) : isInputMember(node));
  let grew = true;
  while (grew) {
    grew = false;
    walk(file.program, (node) => {
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init && isMap(node.init) && !aliases.has(node.id.name)) {
        aliases.add(node.id.name);
        grew = true;
      }
    });
  }
  return aliases;
}

// The keys a destructuring reads. A rename (`{ url: link }`) is a read of
// `url`, which is the name the link has to carry.
function boundKeys(pattern: ObjectPattern): string[] {
  const keys: string[] = [];
  for (const property of pattern.properties) {
    // `...rest` names no key.
    if (property.type === "RestElement") continue;
    const key = property.computed
      ? literalText(property.key)
      : property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "StringLiteral"
          ? property.key.value
          : undefined;
    if (key !== undefined) keys.push(key);
  }
  return keys;
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
