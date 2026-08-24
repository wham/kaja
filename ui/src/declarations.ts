import type { FieldInfo, IMessageType } from "@protobuf-ts/runtime";
import ts from "typescript";

// What a script writes against is TypeScript, so the answer to "what does this method
// take" is a declaration rather than a description of one — and a declaration read out
// of the generated source can't disagree with the code the script is checked against.
//
// The generated text isn't quite it: it carries protobuf bookkeeping (`@generated from
// protobuf field: int32 page_size = 1`) that a script author has no use for, and it
// leaves out what the app knows but TypeScript can't say — that a field is required,
// or travels in the query string. So a declaration is re-emitted from its own AST.
export interface Declaration {
  name: string;
  // The declaration, ready to show.
  text: string;
  // So an answer can close over everything a type reaches.
  references: string[];
}

// maxEnumMembers bounds an enum. A hundred-value enum is a page on its own, and its
// full list is in the generated source.
const maxEnumMembers = 24;

// maxDoc bounds one description. These are the API's own words and can run long.
const maxDoc = 200;

// The marks an app writes onto a field where protobuf has no shape for what it needs
// to say. Declared in server/pkg/apps/openapi/http.proto.
const HTTP_IN_OPTION = "kaja.http_in";
export const HTTP_REQUIRED_OPTION = "kaja.http_required";
const HTTP_PAYLOAD_OPTION = "kaja.http_payload";

// declareInterface re-emits a generated interface as a script would read it.
// messageType, when the stub has one, supplies the marks TypeScript can't carry.
export function declareInterface(node: ts.InterfaceDeclaration, file: ts.SourceFile, messageType?: IMessageType<any>): Declaration {
  const references = new Set<string>();
  const lines: string[] = [`export interface ${node.name.text} {`];

  node.members.forEach((member) => {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) return;
    const name = textOf(member.name, file);
    const type = textOf(member.type, file);
    collectReferences(member.type, file, references);

    const marks = fieldMarks(messageType, name);
    const doc = joinDoc(docText(member, file), marks);
    if (doc) lines.push(`    /** ${doc} */`);
    lines.push(`    ${name}${member.questionToken ? "?" : ""}: ${type};`);
  });

  lines.push("}");
  return { name: node.name.text, text: withDoc(node, file, lines.join("\n")), references: [...references] };
}

// declareEnum re-emits a generated enum. The values are the point — an enum field is
// unwritable without them.
export function declareEnum(node: ts.EnumDeclaration, file: ts.SourceFile): Declaration {
  const lines: string[] = [`export enum ${node.name.text} {`];
  const shown = node.members.slice(0, maxEnumMembers);
  shown.forEach((member) => {
    const name = textOf(member.name, file);
    const value = member.initializer ? ` = ${textOf(member.initializer, file)}` : "";
    lines.push(`    ${name}${value},`);
  });
  if (node.members.length > shown.length) {
    lines.push(`    // … ${node.members.length - shown.length} more`);
  }
  lines.push("}");
  return { name: node.name.text, text: withDoc(node, file, lines.join("\n")), references: [] };
}

// fieldMarks reads what the app said about a field off the runtime field info.
function fieldMarks(messageType: IMessageType<any> | undefined, propertyName: string): string[] {
  const field: FieldInfo | undefined = messageType?.fields?.find((candidate) => candidate.localName === propertyName);
  const options = field?.options;
  if (!options) return [];

  const marks: string[] = [];
  if (options[HTTP_REQUIRED_OPTION] === true) marks.push("required");
  if (typeof options[HTTP_IN_OPTION] === "string" && options[HTTP_IN_OPTION]) marks.push(`${options[HTTP_IN_OPTION]} parameter`);
  if (options[HTTP_PAYLOAD_OPTION]) marks.push("carries the HTTP payload");
  return marks;
}

function withDoc(node: ts.Node, file: ts.SourceFile, body: string): string {
  const doc = joinDoc(docText(node, file), []);
  return doc ? `/** ${doc} */\n${body}` : body;
}

function joinDoc(description: string, marks: string[]): string {
  const parts = [description, ...marks.map((mark) => `[${mark}]`)].filter(Boolean);
  return parts.join(" ");
}

// docText reads a node's JSDoc, dropping the `@generated from protobuf …`
// bookkeeping: it names the wire encoding, which nothing written in TypeScript depends
// on, and it is the only place a reader would meet protobuf at all.
export function docText(node: ts.Node, file: ts.SourceFile): string {
  const fullText = file.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!ranges) return "";

  const lines: string[] = [];
  ranges.forEach((range) => {
    const body = range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? fullText.slice(range.pos + 2, range.end - 2) : fullText.slice(range.pos + 2, range.end);
    body.split("\n").forEach((line) => {
      const text = line.replace(/^\s*\*+\/?/, "").trim();
      if (text && !text.startsWith("@")) lines.push(text);
    });
  });

  const text = lines.join(" ").trim();
  return text.length > maxDoc ? text.slice(0, maxDoc).trimEnd() + "…" : text;
}

// collectReferences gathers the type names a member mentions. Every identifier in the
// type is taken; which of them name a declaration is settled by whoever holds the set,
// so nothing here has to model TypeScript's type syntax.
function collectReferences(type: ts.TypeNode, file: ts.SourceFile, into: Set<string>): void {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) into.add(node.text);
    node.forEachChild(visit);
  };
  visit(type);
}

// textOf reads a node's own source text. The nodes come from a SourceFile parsed
// without parent pointers, so getText() can't find its way back to the text.
function textOf(node: ts.Node, file: ts.SourceFile): string {
  return file.text.slice(node.getStart(file), node.end);
}
