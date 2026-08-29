import type {
  ClientStreamingCall,
  DuplexStreamingCall,
  MethodInfo,
  RpcMetadata,
  RpcOptions,
  RpcStatus,
  RpcTransport,
  UnaryCall,
} from "@protobuf-ts/runtime-rpc";
import { Deferred, RpcError, RpcOutputStreamController, ServerStreamingCall, UnaryCall as UnaryCallImpl } from "@protobuf-ts/runtime-rpc";
import { parseTwirpErrorResponse } from "@protobuf-ts/twirp-transport";
import { isJsonObject, type JsonValue } from "@protobuf-ts/runtime";
import { desktop, onWailsEvent } from "../wails";
import { HEADER_META_PREFIX } from "../appTypes";
import { UPSTREAM_DURATION_TRAILER, UPSTREAM_REQUEST_HEADERS_TRAILER, UPSTREAM_RESPONSE_HEADERS_TRAILER } from "../upstreamHeaders";
import { AppRef, Transport } from "../apps";

export type WailsTransportMode = "api" | "target";

// A bound method that returns an error rejects with a RuntimeError carrying the
// Go error string. Pull a useful message out of whatever shape the rejection
// takes so real failures (e.g. "model is required", an upstream 401) reach the UI
// instead of a generic "Unknown error".
function wailsErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Unknown error";
}

// apiError recovers the error a failed API call carries. The desktop side hands
// the Twirp error JSON back as the rejection - the same body the browser's fetch
// transport reads - so a server's own message ("variable name ... must start
// with a letter") reaches the UI as itself, instead of as whatever decoding that
// JSON as protobuf happens to fail with.
export function apiError(error: unknown): RpcError | undefined {
  const message = wailsErrorMessage(error);
  if (!message.startsWith("{")) return undefined;
  let failure: JsonValue;
  try {
    failure = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (!isJsonObject(failure) || typeof failure.code !== "string" || typeof failure.msg !== "string") return undefined;
  return parseTwirpErrorResponse(failure);
}

// A []byte crosses in either direction as base64.
function requestBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// responseBytes decodes the body a Wails binding hands back: base64 - but a nil
// or empty []byte as JSON null, and atob("null") decodes to three bytes of noise
// that fail as protobuf ("illegal tag: field no 208531"). An empty body is a
// message with every field at its default, which is an ordinary answer:
// SetStoredValue reports no statuses for a variable kaja.json doesn't name yet,
// and a gRPC method may return an empty message. So nothing decodes as an empty
// message.
export function responseBytes(body: unknown): Uint8Array {
  if (typeof body !== "string" || body === "") {
    return new Uint8Array(0);
  }
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

// UpstreamError is an HTTP error response from the invoked app's upstream API
// (or a Twirp error body). Unlike transport failures it is thrown as-is — no
// "transport error" wrapping — and its extra fields (status, request, body,
// ...) end up on the method call's serialized error for the console to show.
class UpstreamError extends Error {
  constructor(message: string, fields: Record<string, unknown>) {
    super(message);
    Object.assign(this, fields);
  }
}

// upstreamError shapes a >= 400 Target result into an UpstreamError. The body is
// the structured error JSON produced by the server (or a Twirp error), so its
// message becomes the error message and the rest — status, statusText, request,
// body — becomes error fields, the same shape the web transport arrives at from
// its trailer. The exchanged upstream headers are mirrored onto the error's
// `meta` in the trailer shape the web transport uses, so the Headers view is
// populated on a failure too.
function upstreamError(result: {
  body: unknown;
  statusCode: number;
  status: string;
  requestHeaders?: { [key: string]: string | undefined };
  responseHeaders?: { [key: string]: string | undefined };
  durationMs?: number;
}): UpstreamError {
  let errorJson: unknown;
  try {
    errorJson = JSON.parse(new TextDecoder().decode(responseBytes(result.body)));
  } catch {
    // Body missing or not JSON; fall back to the HTTP status line.
  }
  let error: UpstreamError;
  if (!errorJson || typeof errorJson !== "object") {
    error = new UpstreamError(`HTTP ${result.statusCode} ${result.status}`, {});
  } else {
    const { msg, message, ...fields } = errorJson as { msg?: unknown; message?: unknown };
    const summary = [msg, message].find((m): m is string => typeof m === "string" && m !== "");
    error = new UpstreamError(summary || `HTTP ${result.statusCode} ${result.status}`, fields);
  }
  const meta: RpcMetadata = {};
  if (result.requestHeaders && Object.keys(result.requestHeaders).length > 0) {
    meta[UPSTREAM_REQUEST_HEADERS_TRAILER] = JSON.stringify(result.requestHeaders);
  }
  if (result.responseHeaders && Object.keys(result.responseHeaders).length > 0) {
    meta[UPSTREAM_RESPONSE_HEADERS_TRAILER] = JSON.stringify(result.responseHeaders);
  }
  if (typeof result.durationMs === "number") {
    meta[UPSTREAM_DURATION_TRAILER] = String(result.durationMs);
  }
  if (Object.keys(meta).length > 0) {
    (error as unknown as { meta: RpcMetadata }).meta = meta;
  }
  return error;
}

// headersFromMeta reads back the headers the client put on the call. The prefix is the
// web door's own convention, used here as the carrier so one merge serves both doors;
// nothing else on the meta is a header the app is sending.
function headersFromMeta(meta: RpcMetadata | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (key.startsWith(HEADER_META_PREFIX)) {
      headers[key.slice(HEADER_META_PREFIX.length)] = String(value);
    }
  }
  return headers;
}

export interface WailsTransportOptions {
  mode: WailsTransportMode;
  appRef?: AppRef; // Dynamic app reference for "target" mode
  protocol: Transport;
}

/**
 * Unified Wails transport that implements RpcTransport for both internal API calls
 * and external target calls using Wails bindings instead of HTTP
 */
export class WailsTransport implements RpcTransport {
  private mode: WailsTransportMode;
  private appRef?: AppRef;
  private protocol: number;

  constructor(options: WailsTransportOptions) {
    this.mode = options.mode;
    this.appRef = options.appRef;
    this.protocol = options.protocol;

    if (this.mode === "target" && !this.appRef) {
      throw new Error("appRef is required when mode is 'target'");
    }
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return {
      timeout: options?.timeout,
      meta: options?.meta || {},
      abort: options?.abort,
      interceptors: options?.interceptors || [],
      ...options,
    };
  }

  unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): UnaryCall<I, O> {
    const response = this.callWails(method, input, options);
    return new UnaryCallImpl(method, options.meta || {}, input, response.trailers, response.response, response.status, response.trailers);
  }

  serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): ServerStreamingCall<I, O> {
    if (this.mode !== "target" || this.protocol !== Transport.GRPC) {
      throw new Error(`Server streaming only supported for gRPC targets in Wails transport`);
    }

    const streamID = crypto.randomUUID();
    const responseStream = new RpcOutputStreamController<O>();
    const headersDeferred = new Deferred<RpcMetadata>();
    const statusDeferred = new Deferred<RpcStatus>();
    const trailersDeferred = new Deferred<RpcMetadata>();

    // Resolve headers immediately (gRPC headers arrive before messages, but we don't capture them yet)
    headersDeferred.resolve({});

    const unsubscribers: (() => void)[] = [];

    const cleanup = () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };

    // Listen for streamed response messages
    unsubscribers.push(
      onWailsEvent<string>("stream:" + streamID, (base64Data) => {
        try {
          const message = method.O.fromBinary(responseBytes(base64Data));
          responseStream.notifyMessage(message);
        } catch (err) {
          responseStream.notifyError(err instanceof Error ? err : new Error(String(err)));
          cleanup();
        }
      }),
    );

    // Listen for stream end. The event carries the stream's upstream duration,
    // mirrored as the same trailer a unary call arrives with.
    unsubscribers.push(
      onWailsEvent("stream:" + streamID + ":end", (durationMs) => {
        responseStream.notifyComplete();
        statusDeferred.resolve({ code: "OK", detail: "" });
        const trailers: RpcMetadata = {};
        if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
          trailers[UPSTREAM_DURATION_TRAILER] = String(durationMs);
        }
        trailersDeferred.resolve(trailers);
        cleanup();
      }),
    );

    // Listen for stream error
    unsubscribers.push(
      onWailsEvent<string>("stream:" + streamID + ":error", (errorMessage) => {
        const err = new Error(errorMessage);
        responseStream.notifyError(err);
        statusDeferred.reject(err);
        trailersDeferred.reject(err);
        cleanup();
      }),
    );

    // Start the stream
    const request = requestBytes(method.I.toBinary(input, { writeUnknownFields: false }));
    const fullMethodPath = `${method.service.typeName}/${method.name}`;
    // The ${NAME} references travel unexpanded; the Go side resolves them.
    const headersJson = JSON.stringify(headersFromMeta(options.meta));

    desktop()
      .then((app) => app.TargetServerStream(this.appRef!.target, fullMethodPath, request, headersJson, streamID))
      .catch((err) => {
        responseStream.notifyError(err instanceof Error ? err : new Error(String(err)));
        statusDeferred.reject(err);
        trailersDeferred.reject(err);
        cleanup();
      });

    // Handle abort signal
    if (options.abort) {
      options.abort.addEventListener("abort", () => {
        void desktop().then((app) => app.CancelStream(streamID)).catch(() => {});
        cleanup();
      });
    }

    return new ServerStreamingCall<I, O>(
      method,
      options.meta || {},
      input,
      headersDeferred.promise,
      responseStream,
      statusDeferred.promise,
      trailersDeferred.promise,
    );
  }

  clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): ClientStreamingCall<I, O> {
    throw new Error(`Client streaming not supported in Wails ${this.mode} transport`);
  }

  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
    throw new Error(`Duplex streaming not supported in Wails ${this.mode} transport`);
  }

  /**
   * Call appropriate Wails function based on mode and handle the response
   */
  private callWails<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): { response: Promise<O>; status: Promise<RpcStatus>; trailers: Promise<RpcMetadata> } {
    const resultPromise = this.executeCall(method, input, options);
    const responsePromise = resultPromise.then((result) => result.output);
    const statusPromise = resultPromise.then(() => ({ code: "OK", detail: "" }));
    const trailersPromise = resultPromise.then((result) => result.trailers);

    return {
      response: responsePromise,
      status: statusPromise,
      trailers: trailersPromise,
    };
  }

  private async executeCall<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): Promise<{ output: O; trailers: RpcMetadata }> {
    try {
      // Serialize input using protobuf-ts. An empty result is valid: a method with
      // no parameters has nothing to encode.
      const request = requestBytes(method.I.toBinary(input, { writeUnknownFields: false }));

      let responseBody: unknown;
      const trailers: RpcMetadata = {};
      const app = await desktop();

      if (this.mode === "api") {
        responseBody = await app.Twirp(method.name, request);
      } else {
        // mode === "target" - the URL is read dynamically from appRef, the headers off the
        // call: they are the app's own with this call's laid over them, merged once in the
        // client so both builds send the same set.
        const fullMethodPath = `${method.service.typeName}/${method.name}`;
        const headersJson = JSON.stringify(headersFromMeta(options.meta));
        const result = (await app.Target(this.appRef!.target, fullMethodPath, request, this.protocol, headersJson))!;

        if (result.statusCode >= 400) {
          // A structured error body: an upstream failure from an app, or a Twirp error.
          throw upstreamError(result);
        }

        // Mirror an in-process app's upstream headers as trailers so the client
        // surfaces them the same way as the web gRPC-Web transport does.
        if (result.requestHeaders && Object.keys(result.requestHeaders).length > 0) {
          trailers[UPSTREAM_REQUEST_HEADERS_TRAILER] = JSON.stringify(result.requestHeaders);
        }
        if (result.responseHeaders && Object.keys(result.responseHeaders).length > 0) {
          trailers[UPSTREAM_RESPONSE_HEADERS_TRAILER] = JSON.stringify(result.responseHeaders);
        }
        // What a gRPC server answered with, under its own names — the same channel the
        // web build's gRPC-Web trailers are, so a script reads one transport's headers
        // the way it reads the other's.
        for (const [name, value] of Object.entries((result as { trailers?: Record<string, string> }).trailers ?? {})) {
          trailers[name] = value;
        }
        // The Go side stamps the upstream exchange; mirrored the same way. Read
        // structurally rather than off the generated TargetResult model, which only
        // gains the field when the next desktop build regenerates the bindings.
        const upstreamDurationMs = (result as { durationMs?: number }).durationMs;
        if (typeof upstreamDurationMs === "number") {
          trailers[UPSTREAM_DURATION_TRAILER] = String(upstreamDurationMs);
        }

        responseBody = result.body;
      }

      // Both API and Target modes use the same response handling (base64 decoding)
      const output = method.O.fromBinary(responseBytes(responseBody));
      return { output, trailers };
    } catch (error) {
      console.error(`Wails ${this.mode} call failed:`, error);
      if (error instanceof UpstreamError) {
        throw error;
      }
      const failure = this.mode === "api" ? apiError(error) : undefined;
      if (failure) {
        throw failure;
      }
      throw new Error(`Wails ${this.mode} transport error: ${wailsErrorMessage(error)}`);
    }
  }
}
