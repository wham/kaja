import { Kaja } from "./kaja";
import { Sources, Stub } from "./sources";
import { ConfigurationApp, ConfigurationProject, Log, RpcProtocol } from "./server/api";

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

// A script file in the global, flat scripts directory (desktop only).
export interface Script {
  // Absolute on-disk path of the script file.
  path: string;
  // Filename (basename), e.g. "ping.ts".
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
  // Set when this project is backed by an app (e.g. the OpenAPI app) instead of a
  // plain gRPC/Twirp service. Drives the OpenApp compilation path and app-style
  // invocation. Undefined for regular projects.
  app?: ConfigurationApp;
}

// appConfiguration synthesizes the ConfigurationProject that an app is rendered
// and invoked through. Apps are gRPC apps: calls go out as gRPC-Web and the
// server transcodes them. The URL is filled in with the app's invocation target
// (kaja-app://<id>) once the app is opened during compilation.
export function appConfiguration(app: ConfigurationApp): ConfigurationProject {
  return {
    name: app.name,
    protocol: RpcProtocol.GRPC,
    url: "",
    protoDir: "",
    useReflection: false,
    headers: { ...(app.headers || {}) },
  };
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
