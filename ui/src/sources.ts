import ts from "typescript";
import { LoadStub as GoLoadStub } from "./wailsjs/go/main/App";

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

function isWailsEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).runtime !== "undefined" &&
    typeof (window as any).go !== "undefined" &&
    typeof (window as any).go.main !== "undefined" &&
    typeof (window as any).go.main.App !== "undefined"
  );
}

async function loadSourceContent(path: string): Promise<string> {
  if (isWailsEnvironment()) {
    // In desktop mode, sources should be embedded in the build or we need a different loading mechanism
    // For now, we'll return empty content - this may need to be implemented differently
    // depending on how sources are made available in the desktop build
    console.warn(`Loading sources in desktop mode not yet implemented for path: ${path}`);
    return "";
  } else {
    // Web mode - use fetch
    return fetch("sources/" + path).then((response) => response.text());
  }
}

export async function loadSources(paths: string[], stub: Stub, projectName: string): Promise<Sources> {
  if (paths.length === 0) {
    return [];
  }

  const sources: Source[] = [];
  let rawFiles: Record<string, () => Promise<string>> = {};
  paths.forEach((path) => {
    path = projectName + "/" + path;
    rawFiles[path] = () => loadSourceContent(path);
  });

  for (const path in rawFiles) {
    const content = await rawFiles[path]();
    if (!content) {
      // Skip empty content (might happen in desktop mode)
      continue;
    }

    const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest);

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

export async function loadStub(projectName: string): Promise<Stub> {
  if (isWailsEnvironment()) {
    try {
      // In desktop mode, use the Go backend to load stub
      const stubJs = await GoLoadStub(projectName);
      console.log("stubJs", stubJs);

      // Create a blob URL and dynamically import the stub
      const blob = new Blob([stubJs], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);

      try {
        const module = await import(url);
        URL.revokeObjectURL(url);
        console.log("module", module);
        return module;
      } catch (importError) {
        URL.revokeObjectURL(url);
        console.warn(`Failed to import stub for project ${projectName}:`, importError);
        return {};
      }
    } catch (error) {
      console.warn(`Failed to load stub from Go backend for project ${projectName}:`, error);
      return {};
    }
  } else {
    const path = "./stub/" + projectName + "/stub.js";
    return import(path);
  }
}
