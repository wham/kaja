import { MethodInfo, RpcTransport, ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import ts from "typescript";
import { addImport, defaultMessage } from "./defaultInput";
import { ExtraLib, Method, Project, Service } from "./project";
import { findInterface, findSourceForClass, loadSources, Source, Sources } from "./sources";

export async function loadProject(paths: string[]): Promise<Project> {
  const sources = await loadSources(paths);
  const globalImports: ts.ImportDeclaration[] = [];
  const globalVars: ts.VariableStatement[] = [];

  const services: Service[] = [];
  const extraLibs: ExtraLib[] = [];

  sources.forEach((source) => {
    const sourceFile = source.file;
    const enums = sourceFile.statements.filter(ts.isEnumDeclaration);
    const serviceInterfaceDefinitions: ts.VariableStatement[] = [];
    const module = source.module;

    source.serviceNames.forEach((serviceName) => {
      if (module && module[serviceName]) {
        const serviceInfo: ServiceInfo = module[serviceName];
        const methods: Method[] = [];
        serviceInfo.methods.forEach((methodInfo) => {
          const methodName = methodInfo.name;
          const globalTrigger = async (input: any) => {
            const url = new URL(window.location.href);
            const urlWithoutPath = `${url.protocol}//${url.hostname}${url.port ? ":" + url.port : ""}`;

            let transport = new TwirpFetchTransport({
              baseUrl: urlWithoutPath + "/twirp",
            });

            let client = await createClient(serviceName, transport, sources);

            try {
              let { response } = await (client as any)[lcfirst(methodName)](input);

              if (window.kaja) {
                window.kaja.onMethodCall(serviceName, methodName, input, response);
              }
            } catch (error) {
              if (window.kaja) {
                window.kaja.onMethodCall(serviceName, methodName, input, error);
              }
            }
          };

          methods.push({
            name: methodName,
            editorCode: methodEditorCode(methodInfo, serviceName, source, sources),
            globalTrigger,
          });
        });
        services.push({
          name: serviceName,
          methods,
        });
        globalImports.push(
          ts.factory.createImportDeclaration(
            undefined, // modifiers
            ts.factory.createImportClause(
              false, // isTypeOnly
              undefined, // name
              ts.factory.createNamedImports([
                ts.factory.createImportSpecifier(
                  false, // propertyName
                  ts.factory.createIdentifier(serviceName),
                  ts.factory.createIdentifier(serviceName + "X"),
                ),
              ]), // elements
            ), // importClause
            ts.factory.createStringLiteral(sourceFile.fileName.replace(".ts", "")), // moduleSpecifier
          ),
        );
        globalVars.push(
          ts.factory.createVariableStatement(
            [], // modifiers
            ts.factory.createVariableDeclarationList(
              [
                ts.factory.createVariableDeclaration(
                  serviceName, // name
                  undefined, // type
                  undefined, // initializer
                  ts.factory.createIdentifier(serviceName + "X"), // value
                ),
              ], // declarations
              ts.NodeFlags.Const, // flags
            ),
          ),
        );

        const result = findInterface(sources, "I" + serviceName + "Client");
        if (result) {
          const [interfaceDeclaration, source] = result;
          const serviceInterfaceDefinition = createServiceInterfaceDefinition(serviceName, interfaceDeclaration, source.file);
          serviceInterfaceDefinitions.push(serviceInterfaceDefinition);
        }
      }
    });

    enums.forEach((enumDeclaration) => {
      const enumName = enumDeclaration.name.text;
      try {
        (window as any)[enumName] = module[enumName];
      } catch (error) {}
    });

    const interfaces = Object.values(source.interfaces);
    if (serviceInterfaceDefinitions.length > 0 || interfaces.length > 0 || enums.length > 0) {
      const moduleDeclaration = ts.factory.createModuleDeclaration(
        [ts.factory.createModifier(ts.SyntaxKind.DeclareKeyword)], // modifiers
        ts.factory.createIdentifier('"' + sourceFile.fileName.replace(".ts", "") + '"'), // name
        ts.factory.createModuleBlock([...serviceInterfaceDefinitions, ...interfaces.map((i) => copyInterface(i)), ...enums.map((e) => copyEnum(e))]), // body
      );

      extraLibs.push({
        filePath: sourceFile.fileName,
        content: printStatements([moduleDeclaration]),
      });
    }
  });

  if (globalImports.length > 0) {
    extraLibs.push({
      filePath: "global-imports",
      content: printStatements([...globalImports, ...globalVars]),
    });
  }

  return {
    services,
    extraLibs,
  };
}

export function registerGlobalTriggers(services: Service[]): void {
  services.forEach((service) => {
    window[service.name as any] = {} as any;
    service.methods.forEach((method) => {
      window[service.name as any][method.name as any] = method.globalTrigger as any;
    });
  });
}

async function createClient(name: string, transport: RpcTransport, sources: Sources): Promise<ServiceInfo | undefined> {
  const className = name + "Client";
  const source = findSourceForClass(sources, className);
  if (!source) {
    return undefined;
  }
  return new source.module[name + "Client"](transport);
}

function getInputParameter(method: ts.MethodSignature, sourceFile: ts.SourceFile): ts.ParameterDeclaration | undefined {
  return method.parameters.find((parameter) => parameter.name.getText(sourceFile) == "input");
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

function createServiceInterfaceDefinition(serviceName: string, interfaceDeclaration: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): ts.VariableStatement {
  const funcs: ts.PropertyAssignment[] = [];
  interfaceDeclaration.members.forEach((member) => {
    if (!ts.isMethodSignature(member)) {
      return;
    }

    if (!member.name) {
      return;
    }

    const methodName = ucfirst(member.name.getText(sourceFile));
    const inputParameter = getInputParameter(member, sourceFile);

    if (!inputParameter || !inputParameter.type) {
      return;
    }

    const inputParameterType = inputParameter.type.getText(sourceFile);

    const func = ts.factory.createPropertyAssignment(
      methodName,
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
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBlock([]),
        /*this.proxyBody(protoService, protoMethod)*/
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

function copyInterface(interfaceDeclaration: ts.InterfaceDeclaration): ts.InterfaceDeclaration {
  const copy = ts.factory.createInterfaceDeclaration(
    interfaceDeclaration.modifiers,
    interfaceDeclaration.name,
    interfaceDeclaration.typeParameters,
    interfaceDeclaration.heritageClauses,
    interfaceDeclaration.members,
  );

  return copy;
}

function copyEnum(enumDeclaration: ts.EnumDeclaration): ts.EnumDeclaration {
  const copy = ts.factory.createEnumDeclaration(undefined, enumDeclaration.name, enumDeclaration.members);

  return copy;
}

function ucfirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function lcfirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
