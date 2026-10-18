import { Call, CallOptions, Kaja } from "./kaja";
import { APP_OF } from "./rateLimit";
import { emptyReflection, Reflection } from "./protoReflection";
import { Sources } from "./sources";
import { WorkspaceApp } from "./server/api";

// Mutable reference clients read at request time, so an app's name and headers are
// picked up without rebuilding the client. There is no transport beside it and no
// address: every app is called as gRPC, at the one door, under the name the call
// already carries — which protocol reaches the API, and whether the server transcodes
// the call or forwards it, is the server's business.
export interface AppRef {
  configuration: WorkspaceApp;
}

export function createAppRef(configuration: WorkspaceApp): AppRef {
  return {
    configuration: { ...configuration },
  };
}

export function updateAppRef(appRef: AppRef, configuration: WorkspaceApp): void {
  appRef.configuration = { ...configuration };
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
  configuration: WorkspaceApp;
  appRef: AppRef;
  compilation: Compilation;
  services: Service[];
  clients: Clients;
  sources: Sources;
  reflection: Reflection;
}

export function createPendingApp(configuration: WorkspaceApp): App {
  return {
    configuration,
    appRef: createAppRef(configuration),
    compilation: { status: "pending", warnings: 0 },
    services: [],
    clients: {},
    sources: [],
    reflection: emptyReflection(),
  };
}

// "cached" is a surface read back from the last session and not yet checked against
// the server, which reads as ready everywhere but the compile log.
export type CompilationStatus = "pending" | "running" | "cached" | "success" | "error";

export interface Compilation {
  status: CompilationStatus;
  duration?: string;
  // What the surface keeps of the compile log: how many warnings it ended with, and
  // the line a failure is stated by. The lines themselves are the store's
  // (appStore.ts), so a line arriving never moves the surface.
  warnings: number;
  error?: string;
}

export function isReady(status: CompilationStatus): boolean {
  return status === "success" || status === "cached";
}

export interface Service {
  name: string;
  packageName: string;
  sourcePath: string;
  // The proto name the runtime knows the service by ("pkg.Shows").
  typeName: string;
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
  // The API asking callers to move off this method. It is still called, so it is a
  // mark on the name rather than anything that stands in the way of one.
  deprecated?: boolean;
}

export interface Clients {
  [key: string]: Client;
}

export interface Methods {
  [key: string]: (input: any, options?: CallOptions) => Call<any>;
  // Which app these methods belong to, so a script can name an app by handing over a
  // service imported from it. A symbol, so it is neither a method nor something the
  // editor's completion list offers.
  readonly [APP_OF]?: string;
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
