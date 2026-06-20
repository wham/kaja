import { Kaja } from "./kaja";
import { Sources, Stub } from "./sources";
import { ConfigurationApp, Log } from "./server/api";

// Transport used to reach an opened app. "grpc"/"twirp" apps talk to their
// upstream directly; in-process apps are reached as gRPC. The numeric values
// match the desktop Wails Target protocol parameter.
export enum Transport {
  GRPC = 1,
  TWIRP = 2,
}

// transportFromProtocol maps the protocol string returned by OpenApp to a Transport.
export function transportFromProtocol(protocol: string): Transport {
  return protocol === "twirp" ? Transport.TWIRP : Transport.GRPC;
}

// Mutable reference that clients read at request time for dynamic access to a
// app's invocation properties (target URL, transport, headers).
export interface AppRef {
  configuration: ConfigurationApp;
  // Invocation target filled in once the app is opened: the upstream URL for
  // grpc/twirp apps, or "kaja-app://<id>" for in-process apps.
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

// A script file in the global, flat scripts directory (desktop only).
export interface Script {
  // Absolute on-disk path of the script file.
  path: string;
  // Filename (basename), e.g. "ping.ts".
  name: string;
}

export interface App {
  configuration: ConfigurationApp;
  appRef: AppRef;
  compilation: Compilation;
  services: Service[];
  clients: Clients;
  sources: Sources;
  stub: Stub;
  // Invocation target and transport, filled in once the app is opened during
  // compilation. Mirror appRef.target/protocol for convenient display.
  target: string;
  protocol: Transport;
}

// createPendingApp builds a fresh app for an app, ready to be compiled.
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
