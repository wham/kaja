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

export interface ProjectScript {
  // Absolute on-disk path of the script file.
  path: string;
  // Filename (basename), e.g. "ping.kaja.ts".
  name: string;
}

export interface Project {
  configuration: ConfigurationProject;
  projectRef: ProjectRef;
  compilation: Compilation;
  services: Service[];
  clients: Clients;
  sources: Sources;
  stub: Stub;
  // Undefined while we haven't tried to list scripts for this project yet
  // (or in web mode where the feature is unavailable). An empty array means
  // "we looked and there were none".
  scripts?: ProjectScript[];
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
  serverStreaming?: boolean;
  clientStreaming?: boolean;
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

export function getDefaultMethod(services: Service[]): { method: Method; service: Service } | undefined {
  for (const service of services) {
    for (const method of service.methods) {
      return { method, service };
    }
  }
  return undefined;
}
