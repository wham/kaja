import ts from "typescript";
import { App, AppRef, Client, Clients, Method, Methods, Service, createAppRef, serviceId } from "../apps";
import { Call, CallOptions, Kaja, MethodCall, callResponseHeaders } from "../kaja";
import { APP_OF } from "../rateLimit";
import { ConfigurationApp } from "../server/api";
import { Sources } from "../sources";
import { appHeaders, mergeHeaders } from "../appTypes";
import { Document, ResolvedOperation } from "./document";
import { buildModule, RestModule, RestOperation } from "./module";
import { buildRequest, requestTarget } from "./request";
import { sendRest } from "./restCall";

/**
 * A REST app, built in the browser from the document itself.
 *
 * Nothing here compiles: there is no proto to generate, no descriptor to load and
 * no stub to evaluate. The document is read into the surface a script writes
 * against, and a call is an HTTP request the browser builds and kaja forwards.
 *
 * What it produces is an ordinary `App`, so everything downstream is untouched —
 * the tree, the finder, the console, the run log, approvals, the rate limiter and
 * the stats all read a `MethodCall`, and a REST call makes one exactly as an RPC
 * call does. That is what makes this a change of how an app is read rather than a
 * second kind of app.
 */

// The module every REST app's surface lives in. One, because a document is one
// document: there is nothing here for a path to tell apart, which is what a path
// after the app's name is for.
const MODULE = "service";

export function loadRestApp(documentJson: string, configuration: ConfigurationApp, target: string): App {
  const document = JSON.parse(documentJson) as Document;
  const module = buildModule(document);
  const appRef = createAppRef(configuration, target);

  const services = servicesOf(module, configuration.name);
  const sources = sourcesOf(module, configuration.name);
  const clients: Clients = {};
  for (const service of services) {
    clients[serviceId(service)] = createRestClient(service, module, appRef);
  }

  return {
    configuration,
    rest: module,
    appRef,
    compilation: { status: "success", logs: [] },
    services,
    clients,
    sources,
    stub: {},
    target,
    protocol: appRef.protocol,
  };
}

// Operations are grouped by their tag, which is the document's own way of saying
// which of them belong together — the same grouping the tree used to get from a
// generated service, arrived at without inventing one.
function servicesOf(module: RestModule, appName: string): Service[] {
  const byTag = new Map<string, Method[]>();

  for (const entry of module.operations) {
    const methods = byTag.get(entry.service) ?? byTag.set(entry.service, []).get(entry.service)!;
    methods.push({
      name: entry.name,
      input: entry.requestType,
      output: entry.responseType,
      doc: entry.operation.summary,
      // What names the method everywhere one is named. It is the API's own
      // address for the operation, and here it is read off the document rather
      // than written onto a generated method as an option.
      http: `${entry.operation.verb} ${entry.operation.path}`,
    });
  }

  return [...byTag.entries()].map(([name, methods]) => ({
    name,
    packageName: "",
    sourcePath: `${appName}/${MODULE}`,
    clientStubModuleId: "",
    methods,
  }));
}

function sourcesOf(module: RestModule, appName: string): Sources {
  const importPath = `${appName}/${MODULE}`;
  const header = `import type { Call, CallOptions } from "kaja";\n\n`;
  const text = header + module.text + "\n";

  return [
    {
      path: `${importPath}.ts`,
      importPath,
      stubModuleId: "",
      file: ts.createSourceFile(`${importPath}.ts`, text, ts.ScriptTarget.Latest),
      serviceNames: [],
      restDoor: true,
      interfaces: {},
      enums: {},
      declarations: module.declarations,
    },
  ];
}

/**
 * The client. A method is a function that builds the request, hands it to the
 * tunnel and records what happened — the same three things `client.ts` does for a
 * compiled app, with the encoding step gone.
 */
function createRestClient(service: Service, module: RestModule, appRef: AppRef): Client {
  const byName = new Map<string, RestOperation>();
  for (const entry of module.operations) byName.set(entry.name, entry);

  const bound = new WeakMap<Kaja, Methods>();

  const bind = (kaja: Kaja): Methods => {
    const methods: Methods = {};
    Object.defineProperty(methods, APP_OF, { get: () => appRef.configuration.name });

    for (const method of service.methods) {
      const entry = byName.get(method.name);
      if (!entry) continue;

      const send = async (input: any, callOptions: CallOptions | undefined, hold: (methodCall: MethodCall) => void) => {
        await kaja._internal.acquireRateLimit(appRef.configuration.name);

        const requestHeaders = mergeHeaders(appHeaders(appRef.configuration), callOptions?.headers);
        const request = buildRequest(entry.operation, input);
        const headers = { ...requestHeaders, ...request.headers };

        const methodCall: MethodCall = {
          id: crypto.randomUUID(),
          appName: appRef.configuration.name,
          service,
          method,
          input,
          requestHeaders: headers,
          timestamp: Date.now(),
        };
        hold(methodCall);
        kaja._internal.methodCallUpdate(methodCall);

        const startedAt = performance.now();
        try {
          const response = await sendRest(appRef, request, headers, kaja._internal.abortSignal);
          methodCall.durationMs = Math.round(performance.now() - startedAt);
          methodCall.upstreamDurationMs = response.durationMs;
          methodCall.responseHeaders = response.headers;
          methodCall.upstreamRequestHeaders = response.requestHeaders;
          methodCall.upstreamResponseHeaders = response.headers;

          const body = readBody(response.body);
          if (response.status >= 400) {
            // An HTTP failure is reported as one: the status labels the call and
            // the body is what the API said about it, which for a REST API is
            // where the reason lives.
            methodCall.error = {
              message: failureMessage(body, response.status),
              status: response.status,
              statusText: "",
              request: `${request.method} ${requestTarget(request)}`,
              body,
            } as any;
          } else {
            methodCall.output = body;
          }
        } catch (error: any) {
          methodCall.durationMs = Math.round(performance.now() - startedAt);
          methodCall.error = { message: error?.message ?? String(error) } as any;
        }

        kaja._internal.methodCallUpdate(methodCall);
        return methodCall.output;
      };

      methods[method.name] = (input: any, callOptions?: CallOptions) => {
        let methodCall: MethodCall | undefined;
        return new Call(
          `${service.name}.${method.name}`,
          input,
          () => send(input, callOptions, (made) => (methodCall = made)),
          () => callResponseHeaders(methodCall),
        );
      };
    }
    return methods;
  };

  return {
    methodsFor(kaja: Kaja): Methods {
      const existing = bound.get(kaja);
      if (existing) return existing;
      const methods = bind(kaja);
      bound.set(kaja, methods);
      return methods;
    },
  };
}

// A body is JSON where it parses as JSON and text where it does not — which is
// what the document said it would be, and what an API that answers with plain
// text on an error path actually sends.
function readBody(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return body;
  }
}

// The sentence a failure is labelled with, taken from where APIs actually put it.
function failureMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["detail", "title", "message", "error"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 200);
  return `HTTP ${status}`;
}

export type { ResolvedOperation };
