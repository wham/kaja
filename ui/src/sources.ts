import ts from "typescript";
import { Source as ApiSource } from "./server/api";

export interface Source {
  path: string;
  importPath: string;
  file: ts.SourceFile;
  serviceNames: string[];
  interfaces: { [key: string]: ts.InterfaceDeclaration };
  enums: { [key: string]: { object: any } };
}

export type Sources = Source[];

export interface Stub {
  [key: string]: any;
}

export async function loadSources(apiSources: ApiSource[], stub: Stub, projectName: string): Promise<Sources> {
  if (apiSources.length === 0) {
    return [];
  }

  const sources: Source[] = [];

  for (let i = 0; i < apiSources.length; i++) {
    const apiSource = apiSources[i];
    const path = projectName + "/" + apiSource.path;
    const file = ts.createSourceFile(path, apiSource.content, ts.ScriptTarget.Latest);

    const source: Source = {
      path,
      importPath: file.fileName.replace(".ts", ""),
      file,
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
        const object = stub[enumName];
        if (object) {
          source.enums[enumName] = { object };
        }
      }
    });

    sources.push(source);
  }

  return sources;
}

export function remapSourcesToNewName(sources: Sources, oldName: string, newName: string): Sources {
  return sources.map((source) => {
    // Replace old project name prefix with new one
    const relativePath = source.path.slice(oldName.length + 1); // +1 for the "/"
    const newPath = newName + "/" + relativePath;
    const newImportPath = newPath.replace(".ts", "");

    // Recreate the TypeScript SourceFile with the new filename
    const newFile = ts.createSourceFile(newPath, source.file.text, ts.ScriptTarget.Latest);

    return {
      ...source,
      path: newPath,
      importPath: newImportPath,
      file: newFile,
    };
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

export async function parseStub(stubCode: string): Promise<Stub> {
  // Create a blob URL and dynamically import the stub JS
  const blob = new Blob([stubCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  const stub = await import(url);
  URL.revokeObjectURL(url);

  return stub;
}
