import { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "typescript";
import { createClient } from "./client";
import { addImport, defaultMessage, MemoryContext } from "./defaultInput";
import { Clients, createProjectRef, Method, Project, ProjectRef, Service, serviceId } from "./project";
import { Source as ApiSource, ConfigurationProject } from "./server/api";
import { findInStub, loadSources, parseStub, Source, Sources, Stub } from "./sources";
import { createMethodKey } from "./typeMemory";

// Generate editor code for a method on-demand (when opening a task tab)
export function generateMethodEditorCode(project: Project, service: Service, method: Method): string {
  // Find the source that matches the service's source path
  const source = project.sources.find((s) => s.importPath === service.sourcePath);
  if (!source) {
    return `// Error: Could not find source for service ${service.name}`;
  }

  // Find the ServiceInfo from the stub
  const serviceInfo: ServiceInfo | undefined = findInStub(project.stub, source, service.name);
  if (!serviceInfo) {
    return `// Error: Could not find service info for ${service.name}`;
  }

  // Find the MethodInfo by matching the method name
  const methodInfo = serviceInfo.methods.find((m) => m.name === method.name);
  if (!methodInfo) {
    return `// Error: Could not find method info for ${method.name}`;
  }

  const memoryContext: MemoryContext = {
    methodKey: createMethodKey(project.configuration.name, service.name, method.name),
    pathPrefix: "",
  };

  return methodEditorCode(methodInfo, service.name, source, project.sources, memoryContext);
}

export async function loadProject(apiSources: ApiSource[], stubCode: string, configuration: ConfigurationProject): Promise<Project> {
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
      const methods: Method[] = [];
      serviceInfo.methods.forEach((methodInfo) => {
        methods.push({
          name: methodInfo.name,
        });
      });
      // Extract package name from typeName (e.g., "quirks.v1.Quirks" -> "quirks.v1")
      const typeName = serviceInfo.typeName || serviceName;
      const lastDotIndex = typeName.lastIndexOf(".");
      const packageName = lastDotIndex > 0 ? typeName.substring(0, lastDotIndex) : "";

      // Find the corresponding .client source file (e.g., proto/v1/quirks.client.ts)
      const clientSourcePath = source.importPath + ".client";
      const clientSource = sources.find((s) => s.importPath === clientSourcePath);

      services.push({
        name: serviceName,
        packageName,
        sourcePath: source.importPath,
        clientStubModuleId: clientSource?.stubModuleId || "",
        methods,
      });

      // Look for the client interface to generate type definitions
      const interfaceName = "I" + serviceName + "Client";
      const interfaceDeclaration = clientSource?.interfaces[interfaceName];
      if (interfaceDeclaration && clientSource) {
        const serviceInterfaceDefinition = createServiceInterfaceDefinition(serviceName, interfaceDeclaration, clientSource.file, serviceInfo);
        serviceInterfaceDefinitions.push(serviceInterfaceDefinition);
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
        // If service source, replace the service class (last statement) with the service interface definitions
        // TODO: This is bad. Won't work if there are multiple services in the source file.
        printStatements([...kajaStatements, ...serviceInterfaceDefinitions]),
        ts.ScriptTarget.Latest,
      ),
      serviceNames: source.serviceNames,
      interfaces: source.interfaces,
      enums: source.enums,
    });
  });

  const projectRef = createProjectRef(configuration);

  return {
    compilation: {
      status: "pending",
      logs: [],
    },
    configuration,
    projectRef,
    services,
    clients: createClients(services, stub, projectRef),
    sources: kajaSources,
    stub,
  };
}

export function createClients(services: Service[], stub: Stub, projectRef: ProjectRef): Clients {
  const clients: Clients = {};

  for (const service of services) {
    clients[serviceId(service)] = createClient(service, stub, projectRef);
  }

  return clients;
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

  // UnaryCall should have type arguments, get the second one (output type)
  if (typeRef.typeArguments && typeRef.typeArguments.length >= 2) {
    return typeRef.typeArguments[1];
  }

  return undefined;
}

function methodEditorCode(methodInfo: MethodInfo, serviceName: string, source: Source, sources: Sources, memoryContext: MemoryContext): string {
  const imports = addImport({}, serviceName, source);
  const input = defaultMessage(methodInfo.I, sources, imports, memoryContext);

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
    // blank line after import
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

function createServiceInterfaceDefinition(
  serviceName: string,
  interfaceDeclaration: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  serviceInfo: ServiceInfo,
): ts.VariableStatement {
  const funcs: ts.PropertyAssignment[] = [];
  interfaceDeclaration.members.forEach((member) => {
    if (!ts.isMethodSignature(member)) {
      return;
    }

    if (!member.name) {
      return;
    }

    const tsMethodName = member.name.getText(sourceFile);
    const protoMethodName = serviceInfo.methods.find((method) => method.name.toLowerCase() == tsMethodName.toLowerCase())?.name || tsMethodName;
    const inputParameter = getInputParameter(member, sourceFile);

    if (!inputParameter || !inputParameter.type) {
      return;
    }

    const inputParameterType = inputParameter.type.getText(sourceFile);

    const func = ts.factory.createPropertyAssignment(
      protoMethodName,
      ts.factory.createArrowFunction(
        [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            "input",
            undefined,
            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(inputParameterType), undefined),
          ),
        ],
        ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Promise"), [
          getOutputType(member, sourceFile) || ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
        ]),
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBlock([]),
      ),
    );
    funcs.push(func);
  });

  const serviceInterfaceDefinition = ts.factory.createVariableStatement(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ts.factory.createVariableDeclarationList(
      [ts.factory.createVariableDeclaration(ts.factory.createIdentifier(serviceName), undefined, undefined, ts.factory.createObjectLiteralExpression(funcs))],
      ts.NodeFlags.Const,
    ),
  );

  return serviceInterfaceDefinition;
}

function isAnotherSourceImport(importDeclaration: ts.ImportDeclaration, sourceFile: ts.SourceFile): boolean {
  const path = importDeclaration.moduleSpecifier.getText(sourceFile).slice(1, -1);

  return path.startsWith("./") || path.startsWith("../");
}
