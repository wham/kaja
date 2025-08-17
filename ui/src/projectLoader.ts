import { MethodInfo, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import ts from "typescript";
import { createClient } from "./client";
import { addImport, defaultMessage } from "./defaultInput";
import { Clients, Method, Project, Service } from "./project";
import { Source as ApiSource, ConfigurationProject } from "./server/api";
import { findInterface, loadSources, loadStub, Source, Sources, Stub } from "./sources";

export async function loadProject(apiSources: ApiSource[], configuration: ConfigurationProject): Promise<Project> {
  const stub = await loadStub(configuration.name);
  const sources = await loadSources(apiSources, stub, configuration.name);
  const kajaSources: Sources = [];
  const services: Service[] = [];

  sources.forEach((source) => {
    const serviceInterfaceDefinitions: ts.VariableStatement[] = [];

    source.serviceNames.forEach((serviceName) => {
      if (!stub[serviceName]) {
        return;
      }

      const serviceInfo: ServiceInfo = stub[serviceName];
      const methods: Method[] = [];
      serviceInfo.methods.forEach((methodInfo) => {
        const methodName = methodInfo.name;

        methods.push({
          name: methodName,
          editorCode: methodEditorCode(methodInfo, serviceName, source, sources),
        });
      });
      services.push({
        name: serviceName,
        methods,
      });

      const result = findInterface(sources, "I" + serviceName + "Client");
      if (result) {
        const [interfaceDeclaration, source] = result;
        const serviceInterfaceDefinition = createServiceInterfaceDefinition(serviceName, interfaceDeclaration, source.file, serviceInfo);
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

  return {
    name: configuration.name,
    services,
    clients: createClients(services, stub, configuration),
    sources: kajaSources,
  };
}

function createClients(services: Service[], stub: Stub, configuration: ConfigurationProject): Clients {
  const clients: Clients = {};

  for (const service of services) {
    clients[service.name] = createClient(service, stub, configuration);
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

function methodEditorCode(methodInfo: MethodInfo, serviceName: string, source: Source, sources: Sources): string {
  const imports = addImport({}, serviceName, source);
  const input = defaultMessage(methodInfo.I, sources, imports);

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
