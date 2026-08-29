import type { IMessageType } from "@protobuf-ts/runtime";
import { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "typescript";
import { createClient } from "./client";
import { addImport, defaultMessage, FieldSet, Imports } from "./defaultInput";
import { Clients, createAppRef, Method, App, AppRef, Service, serviceId, Transport } from "./apps";
import { Source as ApiSource, ConfigurationApp } from "./server/api";
import { docText } from "./declarations";
import { findInStub, loadSources, parseStub, Source, Sources, Stub } from "./sources";
import { moduleSpecifier } from "./appImports";
import { unsupportedReason } from "./streaming";
import { HttpRequest, httpRequestOf, parseHttpRequest, verbMember } from "./httpMethod";
import { doorBinding, REST_DOOR } from "./restDoor";
import { restEditorCode } from "./openapi/module";

// Generate editor code for a method on demand. `fields` is how much of the request is
// written out: the whole shape for a person clicking the method in the tree, the
// required fields alone for a reader who has the declarations already (see FieldSet).
export function generateMethodEditorCode(app: App, service: Service, method: Method, fields: FieldSet = "all"): string {
  // An app read from its own document has no stub to look a method up in: the
  // call is written from the operation, which is the only place it was ever
  // described.
  if (app.rest) {
    const binding = doorBinding(app.configuration.name);
    const call = restEditorCode(app.rest, method.name, binding);
    if (!call) return `// Error: Could not find operation ${method.name}`;
    const alias = binding === REST_DOOR ? REST_DOOR : `${REST_DOOR} as ${binding}`;
    return `import { ${alias} } from ${JSON.stringify(app.configuration.name)};\n\n${call}`;
  }

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

  return methodEditorCode(methodInfo, service.name, source, app, fields);
}

export async function loadApp(apiSources: ApiSource[], stubCode: string, configuration: ConfigurationApp, target: string, protocol: Transport): Promise<App> {
  const stub = await parseStub(stubCode);
  const sources = await loadSources(apiSources, stub, configuration.name);
  const kajaSources: Sources = [];
  const services: Service[] = [];

  sources.forEach((source) => {
    const serviceInterfaceDefinitions: ts.VariableStatement[] = [];
    const restOperations: RestOperation[] = [];

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

      // Collected here because this is where the signature and the message type are both
      // in hand: the door is written from the TypeScript names a script sees, not from
      // the proto the app generated them out of.
      serviceInfo.methods.forEach((methodInfo, index) => {
        const request = httpRequestOf(methods[index]);
        const signature = signatures[methodInfo.name];
        if (request && signature) {
          restOperations.push({ request, signature, requestType: methodInfo.I as IMessageType<object> | undefined });
        }
      });
    });

    const kajaStatements = source.file.statements.filter((statement) => {
      return (
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        (ts.isImportDeclaration(statement) && isAnotherSourceImport(statement, source.file))
      );
    });

    // The door is written per module, over the services that module declares. An app
    // whose proto surface kaja generated has exactly one, so for a REST app that is the
    // whole app — which is what makes one `api` the address of every path it serves.
    const door = restDoorDeclaration(restOperations);

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
        printStatements([...(serviceInterfaceDefinitions.length > 0 ? [kajaTypeImport(door !== "")] : []), ...kajaStatements, ...serviceInterfaceDefinitions]) +
          door,
        ts.ScriptTarget.Latest,
      ),
      serviceNames: source.serviceNames,
      restDoor: door !== "",
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

function methodEditorCode(methodInfo: MethodInfo, serviceName: string, source: Source, app: App, fields: FieldSet): string {
  // A REST method is written the way its own API writes it. The door is the default
  // because the path is the name the API gave the operation — a generated `GetShow` is
  // Kaja's name for something already named — and it is a second address rather than a
  // replacement, so the service form still compiles beside it.
  const request = source.restDoor ? parseHttpRequest(httpRequest(methodInfo)) : undefined;
  const binding = request ? doorBinding(app.configuration.name) : undefined;

  const imports = addImport({}, request ? REST_DOOR : serviceName, source);
  const input = defaultMessage(methodInfo.I, app.sources, imports, new Set(), fields);

  let statements: ts.Statement[] = [];

  // Imports are collected against the module each name is declared in, and only
  // turned into specifiers here: two modules that both answer to the app's name
  // are one import line, not two.
  const bySpecifier: Imports = {};
  for (const path in imports) {
    const declaring = app.sources.find((s) => s.importPath === path);
    for (const name of imports[path]) {
      const specifier = declaring ? moduleSpecifier(app, declaring, name) : path;
      (bySpecifier[specifier] ??= new Set()).add(name);
    }
  }

  for (const path in bySpecifier) {
    statements.push(
      ts.factory.createImportDeclaration(
        undefined, // modifiers
        ts.factory.createImportClause(
          false, // isTypeOnly
          undefined, // name
          ts.factory.createNamedImports(
            [...bySpecifier[path]].map((importedName) => {
              // `api as theatre`: one export name, read under the app's own.
              const aliased = importedName === REST_DOOR && binding !== undefined && binding !== REST_DOOR;
              return ts.factory.createImportSpecifier(
                false, // propertyName
                aliased ? ts.factory.createIdentifier(REST_DOOR) : undefined,
                ts.factory.createIdentifier(aliased ? binding! : importedName),
              );
            }),
          ), // elements
        ), // importClause
        ts.factory.createStringLiteral(path), // moduleSpecifier
      ),
    );
  }

  let call: ts.Statement = ts.factory.createExpressionStatement(
    request
      ? ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(binding!), ts.factory.createIdentifier(verbMember(request))),
          undefined,
          [ts.factory.createStringLiteral(request.path), input],
        )
      : ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(serviceName), ts.factory.createIdentifier(methodInfo.name)),
          undefined,
          [input],
        ),
  );

  // The call is written out even where Kaja won't make it, because the request is
  // still what the method takes and reading it is why you clicked. What the editor
  // says about it — the method is not on the service — reads as Kaja having lost the
  // method, so the line above says whose decision it was.
  const unsupported = unsupportedReason(methodInfo);
  if (unsupported) {
    call = ts.addSyntheticLeadingComment(call, ts.SyntaxKind.SingleLineCommentTrivia, " " + unsupported, true);
  }

  statements = [
    ...statements,
    // A blank line after the import; see
    // https://stackoverflow.com/questions/55246585/how-to-generate-extra-newlines-between-nodes-with-the-typescript-compiler-api-pr
    ts.factory.createIdentifier("\n") as unknown as ts.Statement,
    call,
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

// `import type { Call, CallOptions, Input } from "kaja";` — what a generated service's
// methods return, and what they take. Type-only, so nothing about it survives into
// what a script runs. WithPath rides along only where the module writes a REST door,
// which is the only thing that spells it.
function kajaTypeImport(withPath: boolean): ts.ImportDeclaration {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports(
        [...["Call", "CallOptions", "Input"], ...(withPath ? ["WithPath"] : [])].map((name) =>
          ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(name)),
        ),
      ),
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

// RestOperation is one path the door answers, with the TypeScript a script writes
// against it.
interface RestOperation {
  request: HttpRequest;
  signature: MethodSignature;
  requestType?: IMessageType<object>;
}

// The field option marking a field the API carries in the path. Read rather than the
// `{braces}` in the path template, because a path names the API's parameter and the
// request names the generated field — `{show_id}` against `showId` — and a required
// key nobody can spell is worse than no requirement at all.
const HTTP_IN_OPTION = "kaja.http_in";
const HTTP_REQUIRED_OPTION = "kaja.http_required";

function fieldsWhere(messageType: IMessageType<object> | undefined, predicate: (options: { [key: string]: unknown }) => boolean): string[] {
  return (messageType?.fields ?? []).filter((field) => predicate((field.options ?? {}) as { [key: string]: unknown })).map((field) => field.localName);
}

// restDoorDeclaration writes the door a script addresses a REST app through:
//
//   export const api: {
//     /** Fetch one show. */
//     get(path: "/shows/{showId}", request: WithPath<GetShowRequest, "showId">, options?: CallOptions): Call<Show>;
//   } = {} as never;
//
// One overload per operation rather than a map keyed on the path, because only an
// overload carries the API's own description into the editor's hover and signature
// help — a map's property documentation reaches neither, and the description is the
// thing a generated method name was already failing to say.
//
// The stub is `{} as never` because nothing in the editor's copy runs: the value a
// script gets is bound at run time from the app's clients (restDoor.ts).
function restDoorDeclaration(operations: RestOperation[]): string {
  if (operations.length === 0) return "";

  const byVerb = new Map<string, RestOperation[]>();
  for (const operation of operations) {
    const verb = verbMember(operation.request);
    (byVerb.get(verb) ?? byVerb.set(verb, []).get(verb)!).push(operation);
  }

  const lines: string[] = ["", `export const ${REST_DOOR}: {`];
  for (const [verb, verbOperations] of byVerb) {
    // Sorted by path so the list reads as the API's own index rather than as whatever
    // order the document happened to declare its operations in.
    for (const operation of [...verbOperations].sort((a, b) => a.request.path.localeCompare(b.request.path))) {
      if (operation.signature.doc) {
        lines.push(`    /** ${operation.signature.doc} */`);
      }
      lines.push(`    ${verb}(${overloadParameters(operation)}): Call<${operation.signature.output}>;`);
    }
  }
  lines.push(`} = {} as never;`, "");
  return lines.join("\n");
}

function overloadParameters(operation: RestOperation): string {
  const path = JSON.stringify(operation.request.path);
  const inPath = fieldsWhere(operation.requestType, (options) => options[HTTP_IN_OPTION] === "path");

  // A path parameter is the one field a call cannot leave out, because without it the
  // path is not an address. Everything else stays as Input leaves it.
  const request = inPath.length
    ? `WithPath<${operation.signature.input}, ${inPath.map((name) => JSON.stringify(name)).join(" | ")}>`
    : `Input<${operation.signature.input}>`;

  // The request is offered rather than demanded exactly when the operation insists on
  // nothing: `api.get("/shows")` is the whole call for a listing that takes no
  // parameters, and spelling out `{}` there would be a rule with no reason behind it.
  const required = inPath.length > 0 || fieldsWhere(operation.requestType, (options) => options[HTTP_REQUIRED_OPTION] === true).length > 0;
  return `path: ${path}, request${required ? "" : "?"}: ${request}, options?: CallOptions`;
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
