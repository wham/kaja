import ts from "typescript";

export interface Source {
  path: string;
  importPath: string;
  file: ts.SourceFile;
  module: any;
  serviceNames: string[];
  interfaces: { [key: string]: ts.InterfaceDeclaration };
  enums: { [key: string]: { object: any } };
}

export type Sources = Source[];

export async function loadSources(paths: string[]): Promise<Sources> {
  if (paths.length === 0) {
    return [];
  }

  const sources: Source[] = [];
  let rawFiles: Record<string, () => Promise<string>> = {};
  //const rawFiles = import.meta.glob("./protoc/**/*.ts", { as: "raw", eager: false });
  paths.forEach((path) => {
    rawFiles[path] = () => {
      return fetch(path).then((response) => {
        return response.text();
      });
    };
  });
  //const modules = import.meta.glob("./protoc/**/*.ts");
  console.log("Importing stubs");
  const xxx = "./stub.js";
  const m = await import(xxx);
  //const m = {} as any;
  const modules = {} as any;

  for (const path in rawFiles) {
    if (!modules[path]) {
      //continue;
    }

    const file = ts.createSourceFile(path, await rawFiles[path](), ts.ScriptTarget.Latest);

    const source: Source = {
      path,
      importPath: file.fileName.replace(".ts", ""),
      file,
      module: m,
      serviceNames: [],
      interfaces: {},
      enums: {},
    };

    source.file.statements.forEach((statement) => {
      const serviceName = getServiceName(statement, source.file);
      if (serviceName) {
        source.serviceNames.push(serviceName);
      } else if (ts.isInterfaceDeclaration(statement)) {
        source.interfaces[statement.name.text] = statement;
      } else if (ts.isEnumDeclaration(statement)) {
        const enumName = statement.name.text;
        const object = source.module[enumName];
        if (object) {
          source.enums[enumName] = { object };
        }
      }
    });

    sources.push(source);
  }

  return sources;
}

export function findSourceForClass(sources: Sources, className: string): Source | undefined {
  return sources.find((source) => {
    return source.file.statements.find((statement) => {
      return ts.isClassDeclaration(statement) && statement.name?.escapedText === className;
    });
  });
}

export function findInterface(sources: Sources, interfaceName: string): [ts.InterfaceDeclaration, Source] | undefined {
  for (const source of sources) {
    const interfaceDeclaration = source.interfaces[interfaceName];
    if (interfaceDeclaration) {
      return [interfaceDeclaration, source];
    }
  }
}

export function findEnum(sources: Sources, object: any): [string, Source] | undefined {
  for (const source of sources) {
    for (const enumName in source.enums) {
      if (source.enums[enumName].object === object) {
        return [enumName, source];
      }
    }
  }
}

function getServiceName(statement: ts.Statement, sourceFile: ts.SourceFile): string | undefined {
  if (!ts.isVariableStatement(statement)) {
    return;
  }

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue;
    }

    if (declaration.initializer && ts.isNewExpression(declaration.initializer) && declaration.initializer.expression.getText(sourceFile) === "ServiceType") {
      return declaration.name.text;
    }
  }
}
