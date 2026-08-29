import { generateMethodEditorCode } from "./appLoader";
import { moduleSpecifier } from "./appImports";
import { App, Method, Service } from "./apps";
import { httpRequestOf, verbMember } from "./httpMethod";
import { doorBinding } from "./restDoor";
import { appType } from "./appTypes";
import { Declaration } from "./declarations";
import { kajaModuleDeclaration } from "./kajaModule";
import { StreamingKind, streamingKind } from "./streaming";

// What the MCP server answers from. A script is TypeScript against generated
// TypeScript, so this is TypeScript: the methods a script can call, their
// signatures, the declarations those signatures name, and — for each method —
// the call Kaja itself writes when you click it in the tree. Nothing here
// describes protobuf, because nothing a script author writes is protobuf.
export interface McpCatalog {
  apps: McpApp[];
  // The `kaja` module's declaration, which is half of what a script is written
  // against and is not an app's. It travels with the catalog rather than being
  // restated in the guide, so the agent reads the same text the editor shows —
  // including this workspace's own variable names.
  runtime: string;
}

export interface McpApp {
  name: string;
  type: string;
  // What the app's REST door is read under, where it has one — `theatre` for
  // `import { api as theatre }`. Absent for an app whose methods stand for no
  // HTTP request, which is every app that isn't built from a REST document.
  restBinding?: string;
  services: McpService[];
  // Every type the app's services name, by its TypeScript name. An answer closes
  // over this to reach everything a request or response mentions.
  declarations: { [name: string]: Declaration };
}

export interface McpService {
  name: string;
  // What a script imports the service from.
  importPath: string;
  methods: McpMethod[];
}

export interface McpMethod {
  name: string;
  // The TypeScript a script writes, e.g.
  // "ListShows(input: Input<ListShowsRequest>): Call<ListShowsResponse>" — a Call
  // is awaited like a promise, and is what kaja.approve holds back, and an Input
  // is the request with every field optional.
  signature: string;
  input: string;
  output: string;
  doc?: string;
  // The HTTP request the method stands for, when the app said so. It is the only
  // thing that states whether calling the method reads or writes.
  http?: string;
  // The method as the REST door declares it, where the app has one:
  // `get(path: "/shows/{showId}", request: WithPath<GetShowRequest, "showId">, options?: CallOptions): Call<Show>`.
  // It is what the generated call is written against, so an agent is shown the
  // signature its example is an instance of rather than a second spelling of it.
  restSignature?: string;
  // Which way the method streams. Two of the three are directions Kaja does not
  // carry, which is what the note beside the signature says.
  streaming?: StreamingKind;
  // The generated call, which is the same code clicking the method in the tree
  // writes into a draft — minus the fields the API doesn't insist on, since the
  // declarations are printed above it here and a page of `""` and `0` reads as
  // values being sent. Not a second example generator: one method, one starting
  // point, wherever you came at it from.
  example: string;
}

// buildMcpCatalog gathers what the MCP server serves. Only apps that compiled and
// expose services are listed, so a pending or failed one leaves the rest intact.
export function buildMcpCatalog(apps: App[], variableNames: string[] = []): McpCatalog {
  const catalog: McpCatalog = { apps: [], runtime: kajaModuleDeclaration(variableNames) };

  for (const app of apps) {
    if (app.compilation.status !== "success" || app.services.length === 0) continue;

    // The `.client` modules declare the transport's own I<Service>Client, which
    // no script writes against — the service const does. They contribute nothing
    // to the surface but a name that reads like part of it.
    const declarations: { [name: string]: Declaration } = {};
    for (const source of app.sources) {
      if (source.importPath.endsWith(".client")) continue;
      Object.assign(declarations, source.declarations);
    }

    const restBinding = app.sources.some((source) => source.restDoor) ? doorBinding(app.configuration.name) : undefined;

    catalog.apps.push({
      name: app.configuration.name,
      type: appType(app.configuration),
      ...(restBinding ? { restBinding } : {}),
      declarations,
      services: app.services.map((service) => ({
        name: service.name,
        importPath: importSpecifierFor(app, service),
        methods: service.methods.map((method) => describeMethod(app, service, method)),
      })),
    });
  }

  return catalog;
}

function describeMethod(app: App, service: Service, method: Method): McpMethod {
  const input = method.input ?? "unknown";
  const output = method.output ?? "unknown";
  const described: McpMethod = {
    name: method.name,
    signature: `${method.name}(input: Input<${input}>): Call<${output}>`,
    input,
    output,
    example: generateMethodEditorCode(app, service, method, "required"),
  };
  if (method.doc) described.doc = method.doc;
  if (method.http) described.http = method.http;
  const restSignature = doorSignature(app, service, method);
  if (restSignature) described.restSignature = restSignature;
  const streaming = streamingKind(method);
  if (streaming) described.streaming = streaming;
  return described;
}

// The door's own declaration for this method, read back out of the generated module
// rather than rebuilt: the overload is written once, in appLoader, and a second
// rendering of it here is a thing that can disagree with what the editor checks.
function doorSignature(app: App, service: Service, method: Method): string | undefined {
  const request = httpRequestOf(method);
  const source = app.sources.find((s) => s.importPath === service.sourcePath);
  if (!request || !source?.restDoor) return undefined;

  const declared = new RegExp(`^\\s*(${verbMember(request)}\\(path: ${escapeForRegExp(JSON.stringify(request.path))},.*)$`, "m").exec(source.file.text);
  return declared ? declared[1].replace(/;$/, "") : undefined;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// importSpecifierFor is what a script writes to import the service — the app's
// name, or the module's path where the app declares that name twice.
function importSpecifierFor(app: App, service: Service): string {
  const source = app.sources.find((s) => s.importPath === service.sourcePath);
  return source ? moduleSpecifier(app, source, service.name) : service.sourcePath;
}
