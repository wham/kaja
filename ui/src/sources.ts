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

    // Convert source path to stub module identifier
    // e.g., "basics/lib/enum.ts" -> "basics$lib$enum"
    const stubModuleId = apiSource.path.replace(".ts", "").replace(/\//g, "$").replace(/\./g, "$");
    const stubModule = stub[stubModuleId] || {};

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
        const object = stubModule[enumName];
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

export function findTimestampPaths(sources: Sources, interfaceName: string, prefix: string = ""): string[] {
  const result = findInterface(sources, interfaceName);
  if (!result) return [];

  const [interfaceDecl, source] = result;
  const paths: string[] = [];

  for (const member of interfaceDecl.members) {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;

    const fieldName = member.name.getText(source.file);
    const currentPath = prefix ? `${prefix}.${fieldName}` : fieldName;

    // Check if type contains Timestamp (handles "Timestamp", "Timestamp | undefined", etc.)
    const typeText = member.type.getText(source.file);
    if (typeText.includes("Timestamp")) {
      paths.push(currentPath);
    } else if (ts.isTypeReferenceNode(member.type)) {
      // Recursively check nested message types
      const typeName = member.type.typeName.getText(source.file);
      const nestedPaths = findTimestampPaths(sources, typeName, currentPath);
      paths.push(...nestedPaths);
    }
  }

  return paths;
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

// Find an export by name across all stub modules
export function findInStub(stub: Stub, name: string): any {
  for (const moduleId in stub) {
    const module = stub[moduleId];
    if (module && typeof module === "object" && name in module) {
      return module[name];
    }
  }
  return undefined;
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
