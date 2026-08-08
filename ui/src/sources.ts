import ts from "typescript";
import { Declaration, declareEnum, declareInterface } from "./declarations";
import { Source as ApiSource } from "./server/api";

export interface Source {
  path: string;
  importPath: string;
  stubModuleId: string;
  file: ts.SourceFile;
  serviceNames: string[];
  interfaces: { [key: string]: ts.InterfaceDeclaration };
  enums: { [key: string]: { object: any } };
  // The generated types this source declares, as a script reads them. Built
  // while the source is parsed: the nodes above carry positions into text a
  // later reader doesn't have, and the marks come from the stub module that is
  // only in hand here.
  declarations: { [name: string]: Declaration };
}

export type Sources = Source[];

export interface Stub {
  [key: string]: any;
}

export async function loadSources(apiSources: ApiSource[], stub: Stub, appName: string): Promise<Sources> {
  if (apiSources.length === 0) {
    return [];
  }

  const sources: Source[] = [];

  for (let i = 0; i < apiSources.length; i++) {
    const apiSource = apiSources[i];
    const path = appName + "/" + apiSource.path;
    const file = ts.createSourceFile(path, apiSource.content, ts.ScriptTarget.Latest);

    // Convert source path to stub module identifier
    // e.g., "basics/lib/enum.ts" -> "basics$lib$enum"
    const stubModuleId = apiSource.path.replace(".ts", "").replace(/\//g, "$").replace(/\./g, "$").replace(/-/g, "$");
    const stubModule = stub[stubModuleId] || {};

    const source: Source = {
      path,
      importPath: file.fileName.replace(".ts", ""),
      stubModuleId,
      file,
      serviceNames: [],
      interfaces: {},
      enums: {},
      declarations: {},
    };

    source.file.statements.forEach((statement) => {
      const serviceName = getServiceName(statement, source.file);
      if (serviceName) {
        source.serviceNames.push(serviceName);
      } else if (ts.isInterfaceDeclaration(statement)) {
        source.interfaces[statement.name.text] = statement;
        source.declarations[statement.name.text] = declareInterface(statement, source.file, stubModule[statement.name.text]);
      } else if (ts.isEnumDeclaration(statement)) {
        const enumName = statement.name.text;
        source.declarations[enumName] = declareEnum(statement, source.file);
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
    // Replace old app name prefix with new one
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

export function remapEditorCode(editorCode: string, oldName: string, newName: string): string {
  // Replace import paths that reference the old app name
  // e.g. import { Foo } from "oldName/path" -> import { Foo } from "newName/path"
  const importRegex = new RegExp(`from "${oldName}/`, "g");
  return editorCode.replace(importRegex, `from "${newName}/`);
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

// Find an export by name in the stub module corresponding to a source file
export function findInStub(stub: Stub, source: Source, name: string): any {
  const module = stub[source.stubModuleId];
  return module?.[name];
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
