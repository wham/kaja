import { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "typescript";
import { createClient } from "./client";
import { addImport, defaultMessage, FieldSet } from "./defaultInput";
import { Clients, createAppRef, Method, App, AppRef, Service, serviceId, Transport } from "./apps";
import { Source as ApiSource, ConfigurationApp } from "./server/api";
import { docText } from "./declarations";
import { findInStub, loadSources, parseStub, Source, Sources, Stub } from "./sources";

// Generate editor code for a method on demand. `fields` is how much of the request is
// written out: the whole shape for a person clicking the method in the tree, the
// required fields alone for a reader who has the declarations already (see FieldSet).
export function generateMethodEditorCode(app: App, service: Service, method: Method, fields: FieldSet = "all"): string {
  const source = app.sources.find((s) => s.importPath === service.sourcePath);
  if (!source) {
    return `// Error: Could not find source for service ${service.name}`;
  }

  const serviceInfo: ServiceInfo | undefined = findInStub(app.stub, source, service.name);
  if (!serviceInfo) {
    return `// Error: Could not find service info for ${service.name}`;
  }

  const methodInfo = serviceInfo.methods.find((m) => m.name === method.name);
  if (!methodInfo) {
    return `// Error: Could not find method info for ${method.name}`;
  }

  return methodEditorCode(methodInfo, service.name, source, app.sources, fields);
}

export async function loadApp(apiSources: ApiSource[], stubCode: string, configuration: ConfigurationApp, target: string, protocol: Transport): Promise<App> {
  const stub = await parseStub(stubCode);
  const sources = await loadSources(apiSources, stub, configuration.name);
  const kajaSources: Sources = [];
  const services: Service[] = [];

  sources.forEach((source) => {
    const serviceInterfaceDefinitions: ts.VariableStatement[] = [];

    source.serviceNames.forEach((serviceName) => {
      const serviceInfo: ServiceInfo | undefined = findInStub(stub, source, serviceName);
      if (!serviceInfo) {
        return;
      }
      // Extract the package name from typeName ("quirks.v1.Quirks" -> "quirks.v1").
      const typeName = serviceInfo.typeName || serviceName;
      const lastDotIndex = typeName.lastIndexOf(".");
      const packageName = lastDotIndex > 0 ? typeName.substring(0, lastDotIndex) : "";

      const clientSourcePath = source.importPath + ".client";
      const clientSource = sources.find((s) => s.importPath === clientSourcePath);

      // The generated client interface is where a method's TypeScript signature is written
      // down; it is read once and used for both the service stub the editor checks against
      // and the method model everything else reads.
      const interfaceDeclaration = clientSource?.interfaces["I" + serviceName + "Client"];
      const signatures = interfaceDeclaration && clientSource ? readSignatures(interfaceDeclaration, clientSource.file, serviceInfo) : {};

      const methods: Method[] = serviceInfo.methods.map((methodInfo) => ({
        name: methodInfo.name,
        serverStreaming: methodInfo.serverStreaming,
        clientStreaming: methodInfo.clientStreaming,
        input: signatures[methodInfo.name]?.input,
        output: signatures[methodInfo.name]?.output,
        doc: signatures[methodInfo.name]?.doc,
        http: httpRequest(methodInfo),
      }));

      services.push({
        name: serviceName,
        packageName,
        sourcePath: source.importPath,
        clientStubModuleId: clientSource?.stubModuleId || "",
        methods,
      });

      if (interfaceDeclaration && clientSource) {
        serviceInterfaceDefinitions.push(createServiceInterfaceDefinition(serviceName, interfaceDeclaration, clientSource.file, signatures));
      }
    });

    const kajaStatements = source.file.statements.filter((statement) => {
      return (
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        (ts.isImportDeclaration(statement) && isAnotherSourceImport(statement, source.file))
      );
    });

    kajaSources.push({
      path: source.path,
      importPath: source.importPath,
      stubModuleId: source.stubModuleId,
      file: ts.createSourceFile(
        source.file.fileName,
        // TODO: won't work if there are multiple services in the source file.
        // A method hands back a Call rather than a Promise and takes an Input rather than the
        // request type itself, so the source that declares one says where those types come
        // from — the same module a script imports `kaja` from.
        printStatements([...(serviceInterfaceDefinitions.length > 0 ? [kajaTypeImport()] : []), ...kajaStatements, ...serviceInterfaceDefinitions]),
        ts.ScriptTarget.Latest,
      ),
      serviceNames: source.serviceNames,
      interfaces: source.interfaces,
      enums: source.enums,
      declarations: source.declarations,
    });
  });

  const appRef = createAppRef(configuration, target, protocol);

  return {
    compilation: {
      status: "pending",
      logs: [],
    },
    configuration,
    appRef,
    services,
    clients: createClients(services, stub, appRef),
    sources: kajaSources,
    stub,
    target,
    protocol,
  };
}

function createClients(services: Service[], stub: Stub, appRef: AppRef): Clients {
  const clients: Clients = {};

  for (const service of services) {
    clients[serviceId(service)] = createClient(service, stub, appRef);
  }

  return clients;
}

// Copy a node's leading comments (proto docs the generator emits as JSDoc) onto a
// freshly synthesized node as synthetic comments, so the printer re-emits them.
// Interior lines are re-indented to a single ` *`, since the source indentation would
// otherwise be preserved verbatim.
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
  if (typeRef.typeName.getText(sourceFile) !== "UnaryCall") {
    return undefined;
  }

  // UnaryCall's second type argument is the output type.
  if (typeRef.typeArguments && typeRef.typeArguments.length >= 2) {
    return typeRef.typeArguments[1];
  }

  return undefined;
}

function methodEditorCode(methodInfo: MethodInfo, serviceName: string, source: Source, sources: Sources, fields: FieldSet): string {
  const imports = addImport({}, serviceName, source);
  const input = defaultMessage(methodInfo.I, sources, imports, new Set(), fields);

  let statements: ts.Statement[] = [];

  for (const path in imports) {
    statements.push(
      ts.factory.createImportDeclaration(
        undefined, // modifiers
        ts.factory.createImportClause(
          false, // isTypeOnly
          undefined, // name
          ts.factory.createNamedImports(
            [...imports[path]].map((enumName) => {
              return ts.factory.createImportSpecifier(
                false, // propertyName
                undefined,
                ts.factory.createIdentifier(enumName),
              );
            }),
          ), // elements
        ), // importClause
        ts.factory.createStringLiteral(path), // moduleSpecifier
      ),
    );
  }

  statements = [
    ...statements,
    // A blank line after the import; see
    // https://stackoverflow.com/questions/55246585/how-to-generate-extra-newlines-between-nodes-with-the-typescript-compiler-api-pr
    ts.factory.createIdentifier("\n") as unknown as ts.Statement,
    ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(serviceName), ts.factory.createIdentifier(methodInfo.name)),
        undefined,
        [input],
      ),
    ),
  ];

  return printStatements(statements);
}

export function printStatements(statements: ts.Statement[]): string {
  let sourceFile = ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest, /*setParentNodes*/ false, ts.ScriptKind.TS);
  sourceFile = ts.factory.updateSourceFile(sourceFile, statements);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  return printer.printFile(sourceFile);
}

// MethodSignature is a method as a script writes it. It is read off the generated
// client interface, which is the one place the TypeScript names are written down.
export interface MethodSignature {
  input: string;
  output: string;
  doc?: string;
}

// The client interface names its members in lowerCamelCase, so they are matched back
// to the proto names the rest of Kaja uses.
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
    };
  });

  return signatures;
}

// `import type { Call, Input } from "kaja";` — what a generated service's methods
// return, and what they take. Type-only, so nothing about it survives into what a
// script runs.
function kajaTypeImport(): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports(["Call", "Input"].map((name) => ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name)))),
    ),
    ts.factory.createStringLiteral("kaja"),
  );
}

// createServiceInterfaceDefinition synthesizes the `export const <Service> = {…}` the
// editor checks a script against, from the signatures already read.
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

// httpRequest reads the HTTP request a method transcodes to, when the app wrote one
// onto the method. See server/pkg/apps/openapi/http.proto.
function httpRequest(methodInfo: MethodInfo): string | undefined {
  const value = (methodInfo.options as { [key: string]: unknown } | undefined)?.["kaja.http_request"];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isAnotherSourceImport(importDeclaration: ts.ImportDeclaration, sourceFile: ts.SourceFile): boolean {
  const path = importDeclaration.moduleSpecifier.getText(sourceFile).slice(1, -1);

  return path.startsWith("./") || path.startsWith("../");
}
