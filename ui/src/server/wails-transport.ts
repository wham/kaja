import type {
  RpcTransport,
  MethodInfo,
  RpcOptions,
  UnaryCall,
  ServerStreamingCall,
  ClientStreamingCall,
  DuplexStreamingCall,
  RpcError,
  RpcMetadata,
  RpcStatus,
} from "@protobuf-ts/runtime-rpc";
import { RpcOutputStreamController, UnaryCall as UnaryCallImpl } from "@protobuf-ts/runtime-rpc";
import { Twirp } from "../wailsjs/go/main/App";

/**
 * Wails transport that implements RpcTransport directly for Twirp protocol
 * using Wails bindings instead of HTTP
 */
export class WailsTransport implements RpcTransport {
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
    const response = this.callWailsTwirp(method, input, options);
    return new UnaryCallImpl(method, options.meta || {}, input, response.response, response.status, response.trailers);
  }

  serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): ServerStreamingCall<I, O> {
    throw new Error("Server streaming not supported in Wails transport");
  }

  clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): ClientStreamingCall<I, O> {
    throw new Error("Client streaming not supported in Wails transport");
  }

  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
    throw new Error("Duplex streaming not supported in Wails transport");
  }

  /**
   * Call Wails Twirp function and handle the response
   */
  private callWailsTwirp<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): { response: Promise<O>; status: Promise<RpcStatus>; trailers: Promise<RpcMetadata> } {
    console.log("WailsTransport calling method:", method.name);

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
      console.log("Executing Wails call for method:", method.name);

      // Serialize input using protobuf-ts
      const inputBytes = method.I.toBinary(input, { writeUnknownFields: false });
      const inputArray = Array.from(inputBytes);

      console.log("Calling Wails Twirp with method:", method.name);

      // Call Wails function
      const responseArray = await Twirp(method.name, inputArray);

      console.log("Wails Twirp result:", responseArray);

      // Convert response back to bytes and deserialize
      const responseBytes = new Uint8Array(responseArray);
      const output = method.O.fromBinary(responseBytes);

      return output;
    } catch (error) {
      console.error("WailsTransport error:", error);
      throw new Error(`Wails transport error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
