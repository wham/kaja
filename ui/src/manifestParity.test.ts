import { describe, expect, test } from "bun:test";
import type { FieldInfo, IMessageType } from "@protobuf-ts/runtime";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "@typescript/typescript6";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadApp } from "./appLoader";
import { parseManifest } from "./sources";

// Holds the manifest protoc-gen-kaja writes against the parse of the generated
// TypeScript it replaces. The fixtures are written by the server:
//
//   (cd server && KAJA_PARITY_DIR=/tmp/parity go test -tags development ./pkg/api -run TestWriteManifestParityFixtures)
//   (cd ui && KAJA_PARITY_DIR=/tmp/parity bun test manifestParity)
//
// The old parser below is a copy kept for this comparison alone, until the manifest lands.

(globalThis as any).window = { location: { href: "http://localhost/" } };

const dir = process.env.KAJA_PARITY_DIR;
const fixtures = dir ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];

describe.skipIf(fixtures.length === 0)("the manifest says what the parse said", () => {
  for (const fixture of fixtures) {
    test(fixture, async () => {
      const { sources, stub, manifest } = JSON.parse(readFileSync(join(dir!, fixture), "utf8"));
      const app = await loadApp(parseManifest(manifest), stub, { name: "app", app: { oneofKind: "grpc" } } as any);
      const legacy = await legacyParse(sources, stub, "app");

      const sorted = <T extends { path: string }>(list: T[]) => [...list].sort((a, b) => a.path.localeCompare(b.path));
      const current = sorted(app.sources);
      const expected = sorted(legacy.sources);
      expect(current.map((s) => s.path)).toEqual(expected.map((s) => s.path));
      current.forEach((source, i) => {
        const old = expected[i];
        expect({ path: source.path, serviceNames: source.serviceNames }).toEqual({ path: old.path, serviceNames: old.serviceNames });
        expect({ path: source.path, interfaces: [...source.interfaces].sort() }).toEqual({ path: old.path, interfaces: [...old.interfaces].sort() });
        expect({ path: source.path, enums: Object.keys(source.enums).sort() }).toEqual({ path: old.path, enums: Object.keys(old.enums).sort() });
        expect({ path: source.path, declarations: source.declarations }).toEqual({ path: old.path, declarations: old.declarations });
        expect({ path: source.path, text: source.text }).toEqual({ path: old.path, text: old.text });
      });

      const services = (list: any[]) => list.map((s) => ({ ...s, methods: s.methods.map((m: any) => JSON.parse(JSON.stringify(m))) }));
      expect(services(app.services)).toEqual(services(legacy.services));
    });
  }
});

async function legacyParse(apiSources: { path: string; content: string }[], stubCode: string, appName: string) {
  const url = URL.createObjectURL(new Blob([stubCode], { type: "application/javascript" }));
  const stub = await import(url);
  URL.revokeObjectURL(url);

  const parsed = apiSources.map((apiSource) => {
    const path = appName + "/" + apiSource.path;
    const file = ts.createSourceFile(path, apiSource.content, ts.ScriptTarget.Latest);
    const stubModuleId = apiSource.path.replace(".ts", "").replace(/\//g, "$").replace(/\./g, "$").replace(/-/g, "$");
    const stubModule = stub[stubModuleId] || {};
    const source = {
      path,
      importPath: file.fileName.replace(".ts", ""),
      stubModuleId,
      file,
      serviceNames: [] as string[],
      interfaces: {} as { [key: string]: ts.InterfaceDeclaration },
      enums: {} as { [key: string]: { object: any } },
      declarations: {} as { [name: string]: any },
    };
    file.statements.forEach((statement) => {
      const serviceName = getServiceName(statement, file);
      if (serviceName) {
        source.serviceNames.push(serviceName);
      } else if (ts.isInterfaceDeclaration(statement)) {
        source.interfaces[statement.name.text] = statement;
        source.declarations[statement.name.text] = declareInterface(statement, file, stubModule[statement.name.text]);
      } else if (ts.isEnumDeclaration(statement)) {
        source.declarations[statement.name.text] = declareEnum(statement, file);
        if (stubModule[statement.name.text]) source.enums[statement.name.text] = { object: stubModule[statement.name.text] };
      }
    });
    return source;
  });

  const services: any[] = [];
  const sources = parsed.map((source) => {
    const definitions: ts.VariableStatement[] = [];
    source.serviceNames.forEach((serviceName) => {
      const serviceInfo: ServiceInfo | undefined = stub[source.stubModuleId]?.[serviceName];
      if (!serviceInfo) return;
      const typeName = serviceInfo.typeName || serviceName;
      const lastDotIndex = typeName.lastIndexOf(".");
      const clientSource = parsed.find((s) => s.importPath === source.importPath + ".client");
      const interfaceDeclaration = clientSource?.interfaces["I" + serviceName + "Client"];
      const signatures = interfaceDeclaration && clientSource ? readSignatures(interfaceDeclaration, clientSource.file, serviceInfo) : {};
      services.push({
        name: serviceName,
        packageName: lastDotIndex > 0 ? typeName.substring(0, lastDotIndex) : "",
        sourcePath: source.importPath,
        clientStubModuleId: clientSource?.stubModuleId || "",
        methods: serviceInfo.methods.map((methodInfo) => {
          const value = (methodInfo.options as any)?.["kaja.http_request"];
          return {
            name: methodInfo.name,
            serverStreaming: methodInfo.serverStreaming,
            clientStreaming: methodInfo.clientStreaming,
            input: signatures[methodInfo.name]?.input,
            output: signatures[methodInfo.name]?.output,
            doc: signatures[methodInfo.name]?.doc,
            http: typeof value === "string" && value !== "" ? value : undefined,
            deprecated: signatures[methodInfo.name]?.deprecated,
          };
        }),
      });
      if (interfaceDeclaration && clientSource) {
        definitions.push(
          createServiceInterfaceDefinition(serviceName, interfaceDeclaration, clientSource.file, localSignatures(signatures, clientSource.file, source.file)),
        );
      }
    });
    const statements = source.file.statements.filter(
      (statement) =>
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        (ts.isImportDeclaration(statement) && isAnotherSourceImport(statement, source.file)),
    );
    return {
      path: source.path,
      serviceNames: source.serviceNames,
      interfaces: Object.keys(source.interfaces),
      enums: source.enums,
      declarations: source.declarations,
      text: printStatements([...(definitions.length > 0 ? [kajaTypeImport()] : []), ...statements, ...definitions]),
    };
  });
  return { sources, services };
}

function getServiceName(statement: ts.Statement, sourceFile: ts.SourceFile): string | undefined {
  if (!ts.isVariableStatement(statement)) return;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    if (declaration.initializer && ts.isNewExpression(declaration.initializer) && declaration.initializer.expression.getText(sourceFile) === "ServiceType") {
      return declaration.name.text;
    }
  }
}

interface MethodSignature {
  input: string;
  output: string;
  doc?: string;
  deprecated?: boolean;
}

function isDeprecated(node: ts.Node, file: ts.SourceFile): boolean {
  const fullText = file.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  return (ranges ?? []).some((range) => /^[\s*/]*@deprecated\b/m.test(fullText.slice(range.pos, range.end)));
}

function copyLeadingComments(sourceFile: ts.SourceFile, fromNode: ts.Node, toNode: ts.Node): void {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, fromNode.getFullStart());
  if (!ranges) {
    return;
  }

  ranges.forEach((range) => {
    if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      const text = fullText
        .slice(range.pos + 2, range.end - 2)
        .replace(/\n[ \t]*\*/g, "\n *")
        .replace(/\n[ \t]+$/, "\n ");
      ts.addSyntheticLeadingComment(toNode, range.kind, text, range.hasTrailingNewLine);
    } else {
      ts.addSyntheticLeadingComment(toNode, range.kind, fullText.slice(range.pos + 2, range.end), range.hasTrailingNewLine);
    }
  });
}
function getInputParameter(method: ts.MethodSignature, sourceFile: ts.SourceFile): ts.ParameterDeclaration | undefined {
  return method.parameters.find((parameter) => parameter.name.getText(sourceFile) == "input");
}
function getOutputType(method: ts.MethodSignature, sourceFile: ts.SourceFile): ts.TypeNode | undefined {
  if (!method.type || !ts.isTypeReferenceNode(method.type)) {
    return undefined;
  }

  const typeRef = method.type;
  // A stream from the server is called like any other method and hands back one
  // message, so its message type is the output. The two that stream from the client
  // are declined before they are called, and have none.
  const callType = typeRef.typeName.getText(sourceFile);
  if (callType !== "UnaryCall" && callType !== "ServerStreamingCall") {
    return undefined;
  }

  // The second type argument of either is the output type.
  if (typeRef.typeArguments && typeRef.typeArguments.length >= 2) {
    return typeRef.typeArguments[1];
  }

  return undefined;
}
function printStatements(statements: ts.Statement[]): string {
  let sourceFile = ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  sourceFile = ts.factory.updateSourceFile(sourceFile, statements);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  return printer.printFile(sourceFile);
}
function readSignatures(
  interfaceDeclaration: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  serviceInfo: ServiceInfo,
): { [name: string]: MethodSignature } {
  const signatures: { [name: string]: MethodSignature } = {};

  interfaceDeclaration.members.forEach((member) => {
    if (!ts.isMethodSignature(member) || !member.name) {
      return;
    }
    const tsMethodName = member.name.getText(sourceFile);
    const protoMethodName = serviceInfo.methods.find((method) => method.name.toLowerCase() == tsMethodName.toLowerCase())?.name || tsMethodName;
    const inputParameter = getInputParameter(member, sourceFile);
    if (!inputParameter || !inputParameter.type) {
      return;
    }
    const output = getOutputType(member, sourceFile);
    signatures[protoMethodName] = {
      input: inputParameter.type.getText(sourceFile),
      output: output ? output.getText(sourceFile) : "unknown",
      doc: docText(member, sourceFile) || undefined,
      deprecated: isDeprecated(member, sourceFile) || undefined,
    };
  });

  return signatures;
}
function localSignatures(
  signatures: { [name: string]: MethodSignature },
  clientFile: ts.SourceFile,
  serviceFile: ts.SourceFile,
): { [name: string]: MethodSignature } {
  const imported = importedNames(clientFile);
  const local = new Map([...importedNames(serviceFile)].map(([name, origin]) => [origin, name]));
  const rename = (type: string) => local.get(imported.get(type) ?? "") ?? type;
  return Object.fromEntries(
    Object.entries(signatures).map(([name, signature]) => [name, { ...signature, input: rename(signature.input), output: rename(signature.output) }]),
  );
}
function importedNames(file: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  file.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement) || !isAnotherSourceImport(statement, file)) return;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    const module = (statement.moduleSpecifier as ts.StringLiteral).text;
    bindings.elements.forEach((element) => names.set(element.name.text, module + "#" + (element.propertyName ?? element.name).text));
  });
  return names;
}
function kajaTypeImport(): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports(
        ["Call", "CallOptions", "Input"].map((name) => ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name))),
      ),
    ),
    ts.factory.createStringLiteral("kaja"),
  );
}
function createServiceInterfaceDefinition(
  serviceName: string,
  interfaceDeclaration: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  signatures: { [name: string]: MethodSignature },
): ts.VariableStatement {
  const memberByProtoName = new Map<string, ts.MethodSignature>();
  interfaceDeclaration.members.forEach((member) => {
    if (!ts.isMethodSignature(member) || !member.name) return;
    const tsMethodName = member.name.getText(sourceFile);
    const protoMethodName = Object.keys(signatures).find((name) => name.toLowerCase() === tsMethodName.toLowerCase());
    if (protoMethodName) memberByProtoName.set(protoMethodName, member);
  });

  const funcs: ts.PropertyAssignment[] = [];
  for (const [protoMethodName, signature] of Object.entries(signatures)) {
    const func = ts.factory.createPropertyAssignment(
      protoMethodName,
      ts.factory.createArrowFunction(
        // Not async: a method hands back a Call, which is not a promise the language would
        // let an async function return.
        undefined,
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            "input",
            undefined,
            // Input<T>, so a request may be written with the fields it means and no others.
            // Nothing in a proto is required and the wire format omits a zero anyway, so a
            // spelled-out `""` is a value being sent rather than a field being satisfied.
            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Input"), [
              ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(signature.input), undefined),
            ]),
          ),
          // What the call is made with rather than what it sends: headers laid over the
          // app's own, for this call alone. Optional, because a call that says nothing
          // about them is the ordinary one.
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            "options",
            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("CallOptions"), undefined),
          ),
        ],
        ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Call"), [
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(signature.output), undefined),
        ]),
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBlock([]),
      ),
    );
    // Carry the proto doc comment onto the synthesized method so Monaco shows it on
    // hover and autocomplete.
    const member = memberByProtoName.get(protoMethodName);
    if (member) {
      copyLeadingComments(sourceFile, member, func);
    }
    funcs.push(func);
  }

  // multiLine, so a service with thirty methods is thirty lines rather than one. The
  // printer puts a synthesized object literal on a single line otherwise, and this text
  // is what line-based readers — Monaco's hover, an agent grepping the stub — see.
  return ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          ts.factory.createIdentifier(serviceName),
          undefined,
          undefined,
          ts.factory.createObjectLiteralExpression(funcs, /*multiLine*/ true),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}
function isAnotherSourceImport(importDeclaration: ts.ImportDeclaration, sourceFile: ts.SourceFile): boolean {
  const path = importDeclaration.moduleSpecifier.getText(sourceFile).slice(1, -1);

  return path.startsWith("./") || path.startsWith("../");
}
const maxEnumMembers = 24;
const maxDoc = 200;
const HTTP_IN_OPTION = "kaja.http_in";
const HTTP_REQUIRED_OPTION = "kaja.http_required";
const HTTP_PAYLOAD_OPTION = "kaja.http_payload";
const ENUM_VALUES_OPTION = "kaja.enum_values";
function declareInterface(node: ts.InterfaceDeclaration, file: ts.SourceFile, messageType?: IMessageType<any>) {
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
function declareEnum(node: ts.EnumDeclaration, file: ts.SourceFile) {
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
function fieldMarks(messageType: IMessageType<any> | undefined, propertyName: string): string[] {
  const field: FieldInfo | undefined = messageType?.fields?.find((candidate) => candidate.localName === propertyName);
  const options = field?.options;
  if (!options) return [];

  const marks: string[] = [];
  if (options[HTTP_REQUIRED_OPTION] === true) marks.push("required");
  if (typeof options[HTTP_IN_OPTION] === "string" && options[HTTP_IN_OPTION]) marks.push(`${options[HTTP_IN_OPTION]} parameter`);
  if (options[HTTP_PAYLOAD_OPTION]) marks.push("carries the HTTP payload");
  const values = declaredValues(field);
  if (values.length > 0) marks.push(`one of: ${values.join(", ")}`);
  return marks;
}
function declaredValues(field: FieldInfo | undefined): string[] {
  const values = field?.options?.[ENUM_VALUES_OPTION];
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}
function withDoc(node: ts.Node, file: ts.SourceFile, body: string): string {
  const doc = joinDoc(docText(node, file), []);
  return doc ? `/** ${doc} */\n${body}` : body;
}
function joinDoc(description: string, marks: string[]): string {
  const parts = [description, ...marks.map((mark) => `[${mark}]`)].filter(Boolean);
  return parts.join(" ");
}
function docText(node: ts.Node, file: ts.SourceFile): string {
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
function collectReferences(type: ts.TypeNode, file: ts.SourceFile, into: Set<string>): void {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) into.add(node.text);
    node.forEachChild(visit);
  };
  visit(type);
}
function textOf(node: ts.Node, file: ts.SourceFile): string {
  return file.text.slice(node.getStart(file), node.end);
}
