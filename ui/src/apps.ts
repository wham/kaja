import { Call, Kaja } from "./kaja";
import { Sources, Stub } from "./sources";
import { ConfigurationApp, Log } from "./server/api";

// Transport used to reach an opened app. "grpc"/"twirp" apps talk to their upstream
// directly; in-process apps are reached as gRPC. The numeric values match the desktop
// Wails Target protocol parameter.
export enum Transport {
  GRPC = 1,
  TWIRP = 2,
}

export function transportFromProtocol(protocol: string): Transport {
  return protocol === "twirp" ? Transport.TWIRP : Transport.GRPC;
}

// Mutable reference clients read at request time, so an app's target URL and headers
// are picked up without rebuilding the client.
export interface AppRef {
  configuration: ConfigurationApp;
  // Filled in once the app is opened: the upstream URL for grpc/twirp apps, or
  // "kaja-app://<id>" for in-process ones.
  target: string;
  protocol: Transport;
}

export function createAppRef(configuration: ConfigurationApp, target = "", protocol: Transport = Transport.GRPC): AppRef {
  return {
    configuration: { ...configuration },
    target,
    protocol,
  };
}

export function updateAppRef(appRef: AppRef, configuration: ConfigurationApp, target?: string, protocol?: Transport): void {
  appRef.configuration = { ...configuration };
  if (target !== undefined) appRef.target = target;
  if (protocol !== undefined) appRef.protocol = protocol;
}

// A file has a name and a place; that is the whole of what makes it one rather than a
// draft.
export interface Script {
  // What identifies the script — its console and its stored runs are keyed on it.
  path: string;
  name: string;
  // Relative to the scripts root, forward-slashed. Empty for one at the root; a real
  // directory either way.
  folder: string;
}

// A script's name within the scripts folder — "churn.ts" at the root,
// "reports/churn.ts" filed away. It is what every write takes, because on disk
// renaming a file and moving it are one operation.
export function scriptName(script: { name: string; folder: string }): string {
  return script.folder ? `${script.folder}/${script.name}` : script.name;
}

export interface App {
  configuration: ConfigurationApp;
  appRef: AppRef;
  compilation: Compilation;
  services: Service[];
  clients: Clients;
  sources: Sources;
  stub: Stub;
  // Filled in once the app is opened during compilation. Mirrors appRef.target/protocol
  // for convenient display.
  target: string;
  protocol: Transport;
}

export function createPendingApp(configuration: ConfigurationApp): App {
  return {
    configuration,
    appRef: createAppRef(configuration),
    compilation: { status: "pending", logs: [] },
    services: [],
    clients: {},
    sources: [],
    stub: { serviceInfos: {} },
    target: "",
    protocol: Transport.GRPC,
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
  // The TypeScript a script writes against, read off the generated client interface.
  input?: string;
  output?: string;
  doc?: string;
  // The HTTP request the method stands for, e.g. "GET /shows", when the app said so.
  // The only thing that states whether calling it reads or writes.
  http?: string;
}

export interface Clients {
  [key: string]: Client;
}

export interface Methods {
  [key: string]: (input: any) => Call<any>;
}

export interface Client {
  /**
   * The service's methods, bound to one run. A client is built once per app and shared by
   * every run that imports it, so the run cannot be a field on it — that field is what
   * used to make two scripts running at once report their calls to each other. Binding
   * is memoized per `Kaja`, so the ten imports of one run share one object.
   */
  methodsFor(kaja: Kaja): Methods;
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
