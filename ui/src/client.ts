import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { IMessageType } from "@protobuf-ts/runtime";
import type { MethodInfo, RpcMetadata, RpcOptions, ServerStreamingCall, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { appHeaders, transportHeaders } from "./appTypes";
import { MethodCall, MethodCallHeaders } from "./kaja";
import {
  UPSTREAM_ERROR_TRAILER,
  UPSTREAM_REQUEST_HEADERS_TRAILER,
  UPSTREAM_RESPONSE_HEADERS_TRAILER,
  parseUpstreamError,
  parseUpstreamHeaders,
} from "./upstreamHeaders";
import { Client, AppRef, Service, serviceId, Transport } from "./apps";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { Stub } from "./sources";
import { isWailsEnvironment } from "./wails";

// collectResponseHeaders folds a call's response headers and trailers onto the
// method call, routing the upstream-header trailers to their own fields.
function collectResponseHeaders(methodCall: MethodCall, headers?: RpcMetadata, trailers?: RpcMetadata): void {
  const responseHeaders: MethodCallHeaders = {};
  const absorb = (meta?: RpcMetadata) => {
    if (!meta) return;
    for (const [key, value] of Object.entries(meta)) {
      if (key === UPSTREAM_REQUEST_HEADERS_TRAILER) {
        methodCall.upstreamRequestHeaders = parseUpstreamHeaders(value);
      } else if (key === UPSTREAM_RESPONSE_HEADERS_TRAILER) {
        methodCall.upstreamResponseHeaders = parseUpstreamHeaders(value);
      } else {
        responseHeaders[key] = String(value);
      }
    }
  };
  absorb(headers);
  absorb(trailers);
  methodCall.responseHeaders = responseHeaders;
}

// applyErrorMetadata routes a failed call's response metadata to the Headers
// view, which is where headers belong whether or not the call succeeded — a 401
// is exactly when they matter. The kaja trailers become the upstream hop; what a
// server sent of its own (a gRPC error's trailers) becomes the response headers.
// Web errors carry the metadata on the RpcError; the Wails transport mirrors it.
function applyErrorMetadata(methodCall: MethodCall, error: unknown): void {
  const metaRecord = errorMeta(error);
  if (!metaRecord) return;

  const responseHeaders: MethodCallHeaders = {};
  for (const [key, value] of Object.entries(metaRecord)) {
    switch (key) {
      case UPSTREAM_REQUEST_HEADERS_TRAILER:
        methodCall.upstreamRequestHeaders = parseUpstreamHeaders(value);
        break;
      case UPSTREAM_RESPONSE_HEADERS_TRAILER:
        methodCall.upstreamResponseHeaders = parseUpstreamHeaders(value);
        break;
      case UPSTREAM_ERROR_TRAILER:
        // The failure itself, already shown as the error.
        break;
      default:
        responseHeaders[key] = String(value);
    }
  }
  if (Object.keys(responseHeaders).length > 0) {
    methodCall.responseHeaders = responseHeaders;
  }
}

export function createClient(service: Service, stub: Stub, appRef: AppRef): Client {
  const client: Client = { methods: {} };

  const isTwirp = appRef.protocol === Transport.TWIRP;

  let transport;
  if (isWailsEnvironment()) {
    console.log("Creating client in Wails environment - using WailsTransport in target mode");
    // Use Wails transport in target mode for external API calls (supports both Twirp and gRPC)
    // Pass appRef so URL and headers are read dynamically at request time
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
  const options: RpcOptions = {
    interceptors: [
      {
        // adds X-Target header and configured headers for web environment
        // Reads from appRef dynamically at request time
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          if (!isWailsEnvironment()) {
            options.meta["X-Target"] = appRef.target;
            // Pass configured headers with X-Header- prefix for the backend to
            // forward. Their ${NAME} references travel unexpanded: the server
            // resolves them, because a variable's value may be one it holds and
            // the browser is not allowed to know.
            const headers = transportHeaders(appRef.configuration);
            for (const [key, value] of Object.entries(headers)) {
              options.meta["X-Header-" + key] = value;
            }
          }
          return next(method, input, options);
        },
      },
    ],
  };

  for (const method of service.methods) {
    const isServerStreaming = method.serverStreaming && !method.clientStreaming;
    const inputType: IMessageType<any> | undefined = (clientStub.methods as MethodInfo[] | undefined)?.find((m) => m.name === method.name)?.I;

    client.methods[method.name] = async (input: any) => {
      // Capture request headers from appRef at request time. They are shown as
      // configured, with their ${NAME} references intact - the Headers view
      // reads better that way, and the values behind them stay outside the
      // browser.
      const requestHeaders: { [key: string]: string } = appHeaders(appRef.configuration);

      const methodCall: MethodCall = {
        id: crypto.randomUUID(),
        appName: appRef.configuration.name,
        service,
        method,
        input,
        requestHeaders,
        url: isTwirp ? `${appRef.target.replace(/\/$/, "")}/twirp/${serviceId(service)}/${method.name}` : undefined,
        timestamp: Date.now(),
      };
      client.kaja?._internal.methodCallUpdate(methodCall);

      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);

      // A run that may only read refuses a write here, before anything is sent.
      // The refusal is recorded as the call's failure like any other, so the
      // console gets a row for it — which is the whole point — and, like any
      // other failure, it doesn't stop the script: a snippet holding three
      // writes reports all three rather than one per run.
      const refusal = client.kaja?._internal.guardCall(methodCall);
      if (refusal) {
        methodCall.durationMs = elapsed();
        methodCall.error = serializeError(refusal);
        client.kaja?._internal.methodCallUpdate(methodCall);
        return methodCall.output;
      }

      try {
        // The run's abort signal is read here rather than captured with the
        // client, so every call a script makes joins the run that issued it.
        const abort = client.kaja?._internal.abortSignal;
        // A request is a hand-written object literal, so it is routinely partial:
        // a deleted field, or a oneof left unset, reaches the serializer as
        // `undefined` and fails there with an error that names neither. create()
        // fills those in with the zero values the wire format omits anyway. The
        // literal itself stays on the method call, so the console and the value
        // completions keep showing what was actually written.
        const message = inputType ? inputType.create(input) : input;
        const call = clientStub[lcfirst(method.name)](message, abort ? { ...options, abort } : options);

        if (isServerStreaming) {
          const streamCall = call as ServerStreamingCall<any, any>;
          methodCall.inputTypeName = streamCall.method?.I?.typeName;
          methodCall.inputType = streamCall.method?.I;
          methodCall.outputTypeName = streamCall.method?.O?.typeName;
          methodCall.outputType = streamCall.method?.O;
          methodCall.streamOutputs = [];

          for await (const message of streamCall.responses) {
            methodCall.streamOutputs = [...methodCall.streamOutputs, message];
            methodCall.output = message;
            client.kaja?._internal.methodCallUpdate(methodCall);
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

          // Capture response headers and trailers
          collectResponseHeaders(methodCall, headers, trailers);
        }
      } catch (error: any) {
        methodCall.durationMs = elapsed();
        methodCall.error = callError(error);
        applyErrorMetadata(methodCall, error);
      }

      client.kaja?._internal.methodCallUpdate(methodCall);

      return methodCall.output;
    };
  }

  return client;
}

function lcfirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

// callError turns a thrown error into what the console shows for the call.
//
// A failed call against an HTTP app is an HTTP failure. It reaches the client as
// a gRPC error only because that is how the app is invoked, and the frame it
// travelled in - the gRPC status code, the trailers carrying the real failure and
// the exchanged headers - is not part of what went wrong. When the app reported a
// structured failure, that failure *is* the error; everything else is transport.
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
    // Response metadata is not the error: what it carries is already routed to
    // the Headers view, and the rest is the transport talking about itself.
    if (key === "meta") continue;
    obj[key] = (error as any)[key];
  }
  return obj;
}

// errorMessage reads a thrown error's message, undoing the percent-encoding a
// gRPC status message travels under. grpc-message is percent-encoded UTF-8 by
// spec, but the gRPC-Web client reads trailers byte by byte and hands the value
// through as it found it, so anything non-ASCII arrives escaped.
function errorMessage(error: Error): string {
  if (typeof (error as { code?: unknown }).code !== "string") return error.message;
  try {
    return decodeURIComponent(error.message);
  } catch {
    return error.message;
  }
}
