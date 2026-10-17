import { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "@typescript/typescript6";
import { createClient } from "./client";
import { addImport, defaultMessage, FieldSet, Imports } from "./defaultInput";
import { Clients, createAppRef, Method, App, AppRef, Service, serviceId } from "./apps";
import { WorkspaceApp } from "./server/api";
import { findInStub, loadSources, Manifest, parseStub, Source, Stub } from "./sources";
import { moduleSpecifier } from "./appImports";
import { appType } from "./appTypes";
import { DEPRECATION_NOTE } from "./deprecation";
import { unsupportedReason } from "./streaming";

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

  return methodEditorCode(methodInfo, service.name, source, app, fields, method.deprecated === true);
}

export async function loadApp(manifest: Manifest, stubCode: string, configuration: WorkspaceApp): Promise<App> {
  const stub = await parseStub(stubCode);
  const sources = loadSources(manifest, stub, configuration.name);
  const services: Service[] = [];

  manifest.modules.forEach((module, index) => {
    const source = sources[index];
    for (const service of module.services) {
      const serviceInfo: ServiceInfo | undefined = findInStub(stub, source, service.name);
      if (!serviceInfo) continue;
      // The package is the type name without the service ("quirks.v1.Quirks" -> "quirks.v1").
      const lastDotIndex = service.typeName.lastIndexOf(".");
      const packageName = lastDotIndex > 0 ? service.typeName.substring(0, lastDotIndex) : "";
      const clientSource = sources.find((s) => s.path === configuration.name + "/" + service.clientModule);
      const signatures = new Map(service.methods.map((method) => [method.name, method]));

      const methods: Method[] = serviceInfo.methods.map((methodInfo) => {
        const signature = signatures.get(methodInfo.name);
        return {
          name: methodInfo.name,
          serverStreaming: methodInfo.serverStreaming,
          clientStreaming: methodInfo.clientStreaming,
          input: signature?.input,
          output: signature?.output,
          doc: signature?.doc,
          http: httpRequest(methodInfo),
          deprecated: signature?.deprecated,
        };
      });

      services.push({
        name: service.name,
        packageName,
        sourcePath: source.importPath,
        clientStubModuleId: clientSource?.stubModuleId || "",
        methods,
      });
    }
  });

  const appRef = createAppRef(configuration);

  return {
    compilation: {
      status: "pending",
      logs: [],
    },
    configuration,
    appRef,
    services,
    clients: createClients(services, stub, appRef),
    sources,
    stub,
  };
}

function createClients(services: Service[], stub: Stub, appRef: AppRef): Clients {
  const clients: Clients = {};

  for (const service of services) {
    clients[serviceId(service)] = createClient(service, stub, appRef);
  }

  return clients;
}

function methodEditorCode(methodInfo: MethodInfo, serviceName: string, source: Source, app: App, fields: FieldSet, deprecated: boolean): string {
  const imports = addImport({}, serviceName, source);
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
            [...bySpecifier[path]].map((enumName) => {
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

  let call: ts.Statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(serviceName), ts.factory.createIdentifier(methodInfo.name)),
      undefined,
      [input],
    ),
  );

  // The call is written out even where Kaja won't make it, because the request is
  // still what the method takes and reading it is why you clicked. What the editor
  // says about it — the method is not on the service — reads as Kaja having lost the
  // method, so the line above says whose decision it was. A deprecated method is the
  // other way round: the editor strikes the call through and says nothing about who
  // did it, which is what the line above answers.
  const unsupported = unsupportedReason(methodInfo, appType(app.configuration));
  for (const note of [deprecated ? DEPRECATION_NOTE : undefined, unsupported]) {
    if (note) call = ts.addSyntheticLeadingComment(call, ts.SyntaxKind.SingleLineCommentTrivia, " " + note, true);
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

// httpRequest reads the HTTP request a method transcodes to, when the app wrote one
// onto the method. See server/pkg/apps/openapi/http.proto.
function httpRequest(methodInfo: MethodInfo): string | undefined {
  const value = (methodInfo.options as { [key: string]: unknown } | undefined)?.["kaja.http_request"];
  return typeof value === "string" && value !== "" ? value : undefined;
}
