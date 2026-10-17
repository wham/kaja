import type { File, Node } from "@babel/types";
import { walk } from "./scriptSyntax";

export type Range = [start: number, end: number];

/**
 * Where a script's types are written, so they can be erased rather than compiled.
 * `new Function` takes JavaScript, and what makes TypeScript into JavaScript here is
 * blanking every type out of the text: what is left runs as written, on the line it
 * was written on.
 *
 * That is the rule Node's type stripping runs under, and it refuses what it refuses: an
 * enum, a namespace and a parameter property are TypeScript that emits code, so a
 * script using one is told what to write instead.
 */
export function typeRanges(file: File, code: string): Range[] {
  const ranges: Range[] = [];
  const erase = (start: number | null | undefined, end: number | null | undefined) => ranges.push([start!, end!]);
  // A `?` or `!` written straight after a name, which carries no node of its own.
  const eraseMark = (from: number, marks: string) => {
    let at = from;
    while (at < code.length && /[\s\]]/.test(code[at])) at++;
    if (marks.includes(code[at])) erase(at, at + 1);
  };

  walk(file.program, (node) => {
    if ("declare" in node && node.declare) {
      erase(node.start, node.end);
      return false;
    }
    switch (node.type) {
      case "TSTypeAnnotation":
      case "TSTypeParameterDeclaration":
      case "TSTypeParameterInstantiation":
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
      case "TSDeclareFunction":
      case "TSDeclareMethod":
      case "TSIndexSignature":
        erase(node.start, node.end);
        return false;
      case "ExportNamedDeclaration":
        if (node.exportKind === "type") {
          erase(node.start, node.end);
          return false;
        }
        break;
      case "ImportDeclaration":
        if (node.importKind === "type") {
          erase(node.start, node.end);
          return false;
        }
        break;
      // From the keyword rather than from the expression's end, which sits inside the
      // parentheses of `(a + b) as T`.
      case "TSAsExpression":
        erase(code.lastIndexOf("as", node.typeAnnotation.start!), node.end);
        break;
      case "TSSatisfiesExpression":
        erase(code.lastIndexOf("satisfies", node.typeAnnotation.start!), node.end);
        break;
      case "TSNonNullExpression":
        erase(node.end! - 1, node.end);
        break;
      case "TSTypeAssertion":
        erase(node.start, code.indexOf(">", node.typeAnnotation.end!) + 1);
        break;
      case "Identifier":
        if (node.optional) eraseMark(node.start! + node.name.length, "?");
        break;
      case "VariableDeclarator":
        if (node.definite && node.id.type === "Identifier") eraseMark(node.id.start! + node.id.name.length, "!");
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if ("abstract" in node && node.abstract) eraseWord(code, node.start!, node.id?.start ?? node.body.start!, /\babstract\b/g, erase);
        if (node.implements?.length) erase(code.lastIndexOf("implements", node.implements[0].start!), node.implements.at(-1)!.end);
        break;
      case "ClassProperty":
      case "ClassPrivateProperty":
      case "ClassAccessorProperty":
      case "ClassMethod":
      case "ClassPrivateMethod":
        if ("abstract" in node && node.abstract) {
          erase(node.start, node.end);
          return false;
        }
        eraseWord(code, node.decorators?.at(-1)?.end ?? node.start!, node.key.start!, /\b(?:public|private|protected|readonly|override)\b/g, erase);
        eraseMark(node.key.end!, "?!");
        break;
      case "TSEnumDeclaration":
        refuse(node, "an enum", "use a union of strings, or an object `as const`");
      case "TSModuleDeclaration":
        refuse(node, "a namespace", "use a plain object");
      case "TSParameterProperty":
        refuse(node, "a parameter property", "assign the field in the constructor");
      case "TSImportEqualsDeclaration":
        if (node.importKind === "type") {
          erase(node.start, node.end);
          return false;
        }
        refuse(node, "`import =`", "use an import declaration");
      case "TSExportAssignment":
        refuse(node, "`export =`", "a script exports nothing");
    }
  });
  return ranges;
}

function eraseWord(code: string, from: number, to: number, word: RegExp, erase: (start: number, end: number) => void): void {
  for (const match of code.slice(from, to).matchAll(word)) erase(from + match.index, from + match.index + match[0].length);
}

function refuse(node: Node, what: string, instead: string): never {
  throw new Error(`Line ${node.loc!.start.line}: Kaja runs a script by erasing its types, so ${what} can't run: ${instead}.`);
}

/** The code with every range blanked to spaces, its line breaks kept so every line stays where it was. */
export function blank(code: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    out += code.slice(at, from) + code.slice(from, end).replace(/[^\r\n]/g, " ");
    at = end;
  }
  return out + code.slice(at);
}
