import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { IMessageType } from "@protobuf-ts/runtime";
import type { MethodInfo, RpcMetadata, RpcOptions, ServerStreamingCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { APP_HEADER, appHeaders, HEADER_META_PREFIX, isAppHeader, mergeHeaders, transportHeaders } from "./appTypes";
import { Call, CallOptions, callResponseHeaders, Kaja, MethodCall, MethodCallHeaders } from "./kaja";
import {
  UPSTREAM_DURATION_TRAILER,
  UPSTREAM_ERROR_TRAILER,
  UPSTREAM_REQUEST_HEADERS_TRAILER,
  UPSTREAM_RESPONSE_HEADERS_TRAILER,
  UPSTREAM_TRAILER_PREFIX,
  parseUpstreamDuration,
  parseUpstreamError,
  parseUpstreamHeaders,
} from "./upstreamHeaders";
import { Client, AppRef, Methods, Service, serviceId, Transport } from "./apps";
import { APP_OF } from "./rateLimit";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { Stub } from "./sources";
import { isCallable, NOT_CALLABLE, UNSUPPORTED_CODE } from "./streaming";
import { isWailsEnvironment } from "./wails";

// absorbReserved routes one kaja-upstream-* entry onto the call. The prefix is
// Kaja's own out-of-band channel — what Kaja measured or exchanged upstream, never a
// header the server sent — so a key it doesn't know is consumed rather than shown as
// a response header. The error trailer is among those: it is already the call's error.
function absorbReserved(methodCall: MethodCall, key: string, value: unknown): boolean {
  if (!key.startsWith(UPSTREAM_TRAILER_PREFIX)) return false;
  if (key === UPSTREAM_REQUEST_HEADERS_TRAILER) {
    methodCall.upstreamRequestHeaders = parseUpstreamHeaders(value);
  } else if (key === UPSTREAM_RESPONSE_HEADERS_TRAILER) {
    methodCall.upstreamResponseHeaders = parseUpstreamHeaders(value);
  } else if (key === UPSTREAM_DURATION_TRAILER) {
    methodCall.upstreamDurationMs = parseUpstreamDuration(value);
  }
  return true;
}

function collectResponseHeaders(methodCall: MethodCall, headers?: RpcMetadata, trailers?: RpcMetadata): void {
  const responseHeaders: MethodCallHeaders = {};
  const absorb = (meta?: RpcMetadata) => {
    if (!meta) return;
    for (const [key, value] of Object.entries(meta)) {
      if (!absorbReserved(methodCall, key, value)) {
        responseHeaders[key] = String(value);
      }
    }
  };
  absorb(headers);
  absorb(trailers);
  methodCall.responseHeaders = responseHeaders;
}

// applyErrorMetadata routes a failed call's response metadata to the Headers view,
// where headers belong whether or not the call succeeded — a 401 is exactly when they
// matter. The kaja trailers become the upstream hop; what a server sent of its own
// becomes the response headers. Web errors carry it on the RpcError; Wails mirrors it.
function applyErrorMetadata(methodCall: MethodCall, error: unknown): void {
  const metaRecord = errorMeta(error);
  if (!metaRecord) return;

  const responseHeaders: MethodCallHeaders = {};
  for (const [key, value] of Object.entries(metaRecord)) {
    if (!absorbReserved(methodCall, key, value)) {
      responseHeaders[key] = String(value);
    }
  }
  if (Object.keys(responseHeaders).length > 0) {
    methodCall.responseHeaders = responseHeaders;
  }
}

export function createClient(service: Service, stub: Stub, appRef: AppRef): Client {
  const isTwirp = appRef.protocol === Transport.TWIRP;

  let transport;
  if (isWailsEnvironment()) {
    // Target mode, so both Twirp and gRPC go through it. appRef is passed so the URL and
    // headers are read at request time.
    transport = new WailsTransport({
      mode: "target",
      appRef,
      protocol: appRef.protocol,
    });
  } else {
    if (isTwirp) {
      transport = new TwirpFetchTransport({
        baseUrl: getBaseUrlForTarget(),
      });
    } else {
      transport = new GrpcWebFetchTransport({
        baseUrl: getBaseUrlForTarget(),
      });
    }
  }

  const stubModule = stub[service.clientStubModuleId];
  const ClientClass = stubModule[service.name + "Client"];
  const clientStub = new ClientClass(transport);

  // The headers of one call, on their way to whichever door this build has. They carry
  // the X-Header- prefix in both: their ${NAME} references travel unexpanded, since the
  // value behind one may be kaja's to hold and the browser's never to read, and the Go
  // side resolves them where it applies the app's own credential.
  const requestMeta = (requestHeaders: MethodCallHeaders): RpcMetadata => {
    const meta: RpcMetadata = {};
    for (const [name, value] of Object.entries(transportHeaders(appRef.configuration, requestHeaders))) {
      meta[HEADER_META_PREFIX + name] = value;
    }
    if (!isWailsEnvironment()) {
      meta["X-Target"] = appRef.target;
    }
    return meta;
  };

  // What a method needs that the run has no say in, resolved once rather than per run.
  const prepared = service.methods.map((method) => ({
    method,
    callable: isCallable(method),
    isServerStreaming: method.serverStreaming && !method.clientStreaming,
    inputType: (clientStub.methods as MethodInfo[] | undefined)?.find((m) => m.name === method.name)?.I as IMessageType<any> | undefined,
  }));

  // Bound methods are kept per run rather than rebuilt per import, and weakly, so a
  // run's bindings go when the run's Kaja does.
  const bound = new WeakMap<Kaja, Methods>();

  const bind = (kaja: Kaja): Methods => {
    const methods: Methods = {};
    // Read rather than captured, so a renamed app still answers for its own budget.
    Object.defineProperty(methods, APP_OF, { get: () => appRef.configuration.name });
    for (const { method, callable, isServerStreaming, inputType } of prepared) {
      const newMethodCall = (input: any, requestHeaders: MethodCallHeaders): MethodCall => ({
        id: crypto.randomUUID(),
        appName: appRef.configuration.name,
        service,
        method,
        input,
        requestHeaders,
        url: isTwirp ? `${appRef.target.replace(/\/$/, "")}/twirp/${serviceId(service)}/${method.name}` : undefined,
        timestamp: Date.now(),
      });

      const send = async (input: any, callOptions: CallOptions | undefined, hold: (methodCall: MethodCall) => void) => {
        // The app's headers with the call's own laid over them, shown as written — with
        // their ${NAME} references intact, since the Headers view reads better that way and
        // the values behind them stay outside the browser.
        const requestHeaders = mergeHeaders(appHeaders(appRef.configuration), callOptions?.headers);

        // Refused here rather than by the transport: each build has one of its own, each
        // with its own wording, and both of them describe themselves where the limit is
        // Kaja's. It is still a row, because the script did make the call.
        if (!callable) {
          const refused = newMethodCall(input, requestHeaders);
          hold(refused);
          refused.error = { message: NOT_CALLABLE, code: UNSUPPORTED_CODE };
          kaja._internal.methodCallUpdate(refused);
          return undefined;
        }

        // Before the call exists, which is the whole of why a held call costs the log
        // nothing and the percentiles nothing: no row is written and no clock is started
        // until the budget lets it through. Resolves immediately unless this run asked
        // for a limiter on this app.
        await kaja._internal.acquireRateLimit(appRef.configuration.name);

        const methodCall = newMethodCall(input, requestHeaders);
        hold(methodCall);
        kaja._internal.methodCallUpdate(methodCall);

        const startedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - startedAt);

        try {
          // The signal belongs to the run these methods were bound for, so Stop reaches the
          // calls of that run and no others.
          const abort = kaja._internal.abortSignal;
          // A request is a hand-written object literal, so it is routinely partial: a deleted
          // field, or a oneof left unset, reaches the serializer as `undefined` and fails there
          // with an error that names neither. create() fills those in with the zero values the
          // wire format omits anyway. The literal itself stays on the method call, so the
          // console and the value completions keep showing what was actually written.
          const message = inputType ? inputType.create(input) : input;
          const options: RpcOptions = { meta: requestMeta(requestHeaders) };
          const call = clientStub[lcfirst(method.name)](message, abort ? { ...options, abort } : options);

          if (isServerStreaming) {
            const streamCall = call as ServerStreamingCall<any, any>;
            methodCall.inputTypeName = streamCall.method?.I?.typeName;
            methodCall.inputType = streamCall.method?.I;
            methodCall.outputTypeName = streamCall.method?.O?.typeName;
            methodCall.outputType = streamCall.method?.O;
            methodCall.streamOutputs = [];

            for await (const message of streamCall.responses) {
              // Appended, not copied: the console holds this object rather than a snapshot, so
              // rebuilding the array per message would be quadratic for a stream nothing reads
              // differently.
              methodCall.streamOutputs.push(message);
              methodCall.output = message;
              kaja._internal.methodCallUpdate(methodCall);
            }
            methodCall.streamComplete = true;
            methodCall.durationMs = elapsed();

            const [headers, trailers] = await Promise.all([streamCall.headers, streamCall.trailers]);
            collectResponseHeaders(methodCall, headers, trailers);
          } else {
            const [response, headers, trailers] = await Promise.all([call.response, call.headers, call.trailers]);
            methodCall.durationMs = elapsed();
            methodCall.output = response;
            methodCall.inputTypeName = call.method?.I?.typeName;
            methodCall.inputType = call.method?.I;
            methodCall.outputTypeName = call.method?.O?.typeName;
            methodCall.outputType = call.method?.O;

            collectResponseHeaders(methodCall, headers, trailers);
          }
        } catch (error: any) {
          methodCall.durationMs = elapsed();
          methodCall.error = callError(error);
          applyErrorMetadata(methodCall, error);
        }

        kaja._internal.methodCallUpdate(methodCall);

        return methodCall.output;
      };

      // A call is handed back rather than made: it goes out when the script awaits it, or
      // at the end of the tick if nothing has claimed it. Everything above happens when the
      // call starts, its log row included, so a call that was never approved was never
      // anywhere. The method call is held as it is made, which is what lets the call hand
      // back the headers it was answered with.
      methods[method.name] = (input: any, callOptions?: CallOptions) => {
        refuseReservedHeaders(callOptions);
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
      const held = bound.get(kaja);
      if (held) return held;
      const methods = bind(kaja);
      bound.set(kaja, methods);
      return methods;
    },
  };
}

// The reserved header is how a call finds its app — the credential and the transport
// security kaja holds for it are looked up by that name — so a call written to set it
// is refused where it is written rather than sent somewhere else's credential.
function refuseReservedHeaders(callOptions: CallOptions | undefined): void {
  for (const name of Object.keys(callOptions?.headers ?? {})) {
    if (isAppHeader(name)) {
      throw new Error(`${APP_HEADER} is kaja's own: it names the app a call belongs to and cannot be set on a call.`);
    }
  }
}

function lcfirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

// callError turns a thrown error into what the console shows for the call.
//
// A failed call against an HTTP app is an HTTP failure. It reaches the client as a
// gRPC error only because that is how the app is invoked, and the frame it travelled
// in — the status code, the trailers carrying the real failure, the exchanged headers
// — is not part of what went wrong.
function callError(error: unknown): any {
  const meta = errorMeta(error);
  if (meta) {
    const upstream = parseUpstreamError(meta[UPSTREAM_ERROR_TRAILER]);
    if (upstream) return upstream;
  }
  return serializeError(error);
}

function errorMeta(error: unknown): Record<string, unknown> | undefined {
  const meta = error && typeof error === "object" ? (error as { meta?: unknown }).meta : undefined;
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : undefined;
}

function serializeError(error: any): any {
  if (!(error instanceof Error)) {
    return error;
  }
  const obj: any = { message: errorMessage(error) };
  for (const key of Object.keys(error)) {
    // Response metadata is not the error: what it carries is already routed to the
    // Headers view, and the rest is the transport talking about itself.
    if (key === "meta") continue;
    obj[key] = (error as any)[key];
  }
  return obj;
}

// errorMessage undoes the percent-encoding a gRPC status message travels under.
// grpc-message is percent-encoded UTF-8 by spec, but the gRPC-Web client reads
// trailers byte by byte and hands the value through as it found it.
function errorMessage(error: Error): string {
  if (typeof (error as { code?: unknown }).code !== "string") return error.message;
  try {
    return decodeURIComponent(error.message);
  } catch {
    return error.message;
  }
}
