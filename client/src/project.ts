import ts from "typescript";

export type Project = {
  services: Array<Service>;
  extraLibs: Array<ExtraLib>;
};

export type Service = {
  name: string;
  methods: Array<Method>;
};

export type Method = {
  name: string;
  editorCode: string;
  globalTrigger: (input: any) => {};
};

export type ExtraLib = {
  filePath: string;
  content: string;
};

export type InterfaceMap = { [key: string]: { interfaceDeclaration: ts.InterfaceDeclaration; sourceFile: ts.SourceFile } };

export function methodId(service: Service, method: Method): string {
  return `${service.name}.${method.name}`;
}

export function getDefaultMethod(services: Service[]): Method | undefined {
  for (const service of services) {
    for (const method of service.methods) {
      return method;
    }
  }
  return undefined;
}
