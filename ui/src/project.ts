import { Kaja } from "./kaja";
import { Sources, Stub } from "./sources";
import { ConfigurationProject, Log } from "./server/api";

// Mutable reference that clients read at request time for dynamic access to project properties
export interface ProjectRef {
  configuration: ConfigurationProject;
}

export function createProjectRef(configuration: ConfigurationProject): ProjectRef {
  return {
    configuration: { ...configuration, headers: { ...(configuration.headers || {}) } },
  };
}

export function updateProjectRef(projectRef: ProjectRef, configuration: ConfigurationProject): void {
  projectRef.configuration = { ...configuration, headers: { ...(configuration.headers || {}) } };
}

export interface Project {
  configuration: ConfigurationProject;
  projectRef: ProjectRef;
  compilation: Compilation;
  services: Service[];
  clients: Clients;
  sources: Sources;
  stub: Stub;
}

export type CompilationStatus = "pending" | "running" | "success" | "error";

export interface Compilation {
  id?: string;
  status: CompilationStatus;
  logs: Log[];
  duration?: string;
  startTime?: number;
  logOffset?: number;
}

export interface Service {
  name: string;
  packageName: string;
  sourcePath: string;
  clientStubModuleId: string;
  methods: Array<Method>;
}

export interface Method {
  name: string;
  editorCode: string;
}

export interface Clients {
  [key: string]: Client;
}

export interface Client {
  kaja?: Kaja;
  methods: { [key: string]: (input: any) => {} };
}

export function serviceId(service: Service): string {
  return service.packageName ? `${service.packageName}.${service.name}` : service.name;
}

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
