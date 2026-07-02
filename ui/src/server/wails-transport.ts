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
import { Deferred, RpcOutputStreamController, ServerStreamingCall, UnaryCall as UnaryCallImpl } from "@protobuf-ts/runtime-rpc";
import { Twirp, Target, TargetServerStream, CancelStream } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime";
import { appHeaders } from "../appTypes";
import { expandHeaders } from "../variableExpansion";
import { AppRef, Transport } from "../apps";

export type WailsTransportMode = "api" | "target";

// Wails (v2) rejects a bound-method promise with the Go error string, not an
// Error object. Pull a useful message out of whatever shape the rejection takes
// so real failures (e.g. "model is required", an upstream 401) reach the UI
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

// upstreamError shapes a >= 400 Target result into an UpstreamError. The body
// is the structured error JSON produced by the server (or a Twirp error), so
// its message becomes the error message and the rest becomes error fields.
function upstreamError(result: { body: unknown; statusCode: number; status: string }): UpstreamError {
  let errorJson: unknown;
  try {
    const bodyBytes = Uint8Array.from(atob(result.body as string), (c) => c.charCodeAt(0));
    errorJson = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    // Body missing or not JSON; fall back to the HTTP status line.
  }
  if (!errorJson || typeof errorJson !== "object") {
    return new UpstreamError(`HTTP ${result.statusCode} ${result.status}`, {});
  }
  const { msg, message, ...fields } = errorJson as { msg?: unknown; message?: unknown };
  const summary = [msg, message].find((m): m is string => typeof m === "string" && m !== "");
  return new UpstreamError(summary || `HTTP ${result.statusCode} ${result.status}`, fields);
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
      EventsOn("stream:" + streamID, (base64Data: string) => {
        try {
          const responseBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
          const message = method.O.fromBinary(responseBytes);
          responseStream.notifyMessage(message);
        } catch (err) {
          responseStream.notifyError(err instanceof Error ? err : new Error(String(err)));
          cleanup();
        }
      }),
    );

    // Listen for stream end
    unsubscribers.push(
      EventsOn("stream:" + streamID + ":end", () => {
        responseStream.notifyComplete();
        statusDeferred.resolve({ code: "OK", detail: "" });
        trailersDeferred.resolve({});
        cleanup();
      }),
    );

    // Listen for stream error
    unsubscribers.push(
      EventsOn("stream:" + streamID + ":error", (errorMessage: string) => {
        const err = new Error(errorMessage);
        responseStream.notifyError(err);
        statusDeferred.reject(err);
        trailersDeferred.reject(err);
        cleanup();
      }),
    );

    // Start the stream
    const inputBytes = method.I.toBinary(input, { writeUnknownFields: false });
    const inputArray = Array.from(inputBytes);
    const fullMethodPath = `${method.service.typeName}/${method.name}`;
    const headersJson = JSON.stringify(expandHeaders(appHeaders(this.appRef!.configuration)));

    TargetServerStream(this.appRef!.target, fullMethodPath, inputArray, headersJson, streamID).catch((err) => {
      responseStream.notifyError(err instanceof Error ? err : new Error(String(err)));
      statusDeferred.reject(err);
      trailersDeferred.reject(err);
      cleanup();
    });

    // Handle abort signal
    if (options.abort) {
      options.abort.addEventListener("abort", () => {
        CancelStream(streamID).catch(() => {});
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
    console.log(
      `Wails${this.mode === "target" ? "Target" : ""}Transport calling method:`,
      this.mode === "target" ? `${method.service.typeName}/${method.name}` : method.name,
      this.mode === "target" ? `target: ${this.appRef?.target}` : "",
    );

    const responsePromise = this.executeCall(method, input);
    const statusPromise = responsePromise.then(() => ({ code: "OK", detail: "" }));
    const trailersPromise = responsePromise.then(() => ({}));

    return {
      response: responsePromise,
      status: statusPromise,
      trailers: trailersPromise,
    };
  }

  private async executeCall<I extends object, O extends object>(method: MethodInfo<I, O>, input: I): Promise<O> {
    try {
      console.log(`Executing Wails ${this.mode} call for method:`, method.name);
      if (this.mode === "target") {
        console.log("Target URL:", this.appRef?.target);
      }
      console.log("Input object:", input);

      // Serialize input using protobuf-ts
      const inputBytes = method.I.toBinary(input, { writeUnknownFields: false });
      console.log("Serialized inputBytes length:", inputBytes.length);

      // Empty serialization is valid for methods with no parameters
      if (inputBytes.length === 0 && this.mode === "api") {
        console.log("Empty serialization - this is valid for methods with no parameters like GetConfiguration");
      }

      // Convert to array and ensure all values are valid bytes (0-255)
      const inputArray = Array.from(inputBytes);
      console.log("Input array length:", inputArray.length);

      // Validate that all values are proper bytes (only if there are bytes)
      if (inputArray.length > 0) {
        const invalidBytes = inputArray.filter((b) => b < 0 || b > 255 || !Number.isInteger(b));
        if (invalidBytes.length > 0) {
          throw new Error(`Invalid byte values found: ${invalidBytes}`);
        }
      }

      let responseBase64: unknown;

      if (this.mode === "api") {
        console.log("Calling Wails Twirp with method:", method.name);
        responseBase64 = await Twirp(method.name, inputArray);
      } else {
        // mode === "target" - read URL and headers dynamically from appRef
        const fullMethodPath = `${method.service.typeName}/${method.name}`;
        const headersJson = JSON.stringify(expandHeaders(appHeaders(this.appRef!.configuration)));
        console.log("Calling Wails Target with method:", fullMethodPath, "protocol:", this.protocol, "headers:", headersJson);
        const result = await Target(this.appRef!.target, fullMethodPath, inputArray, this.protocol, headersJson);

        if (result.statusCode >= 400) {
          // A structured error body: an upstream failure from an app, or a Twirp error.
          throw upstreamError(result);
        }

        responseBase64 = result.body;
      }

      console.log(`Wails ${this.mode} result:`, responseBase64);

      // Both API and Target modes use the same response handling (base64 decoding)
      const responseBytes = Uint8Array.from(atob(responseBase64 as string), (c) => c.charCodeAt(0));

      const output = method.O.fromBinary(responseBytes);
      console.log(`Wails ${this.mode} output:`, output);
      return output;
    } catch (error) {
      console.error(`Wails ${this.mode} call failed:`, error);
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw new Error(`Wails ${this.mode} transport error: ${wailsErrorMessage(error)}`);
    }
  }
}
