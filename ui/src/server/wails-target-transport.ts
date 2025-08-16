import type {
  ClientStreamingCall,
  DuplexStreamingCall,
  MethodInfo,
  RpcMetadata,
  RpcOptions,
  RpcStatus,
  RpcTransport,
  ServerStreamingCall,
  UnaryCall,
} from "@protobuf-ts/runtime-rpc";
import { UnaryCall as UnaryCallImpl } from "@protobuf-ts/runtime-rpc";
import { Target } from "../wailsjs/go/main/App";

/**
 * Wails target transport that implements RpcTransport for external API calls
 * using Wails bindings instead of HTTP proxy
 */
export class WailsTargetTransport implements RpcTransport {
  private targetUrl: string;

  constructor(targetUrl: string) {
    this.targetUrl = targetUrl;
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
    const response = this.callWailsTarget(method, input, options);
    return new UnaryCallImpl(method, options.meta || {}, input, response.trailers, response.response, response.status, response.trailers);
  }

  serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): ServerStreamingCall<I, O> {
    throw new Error("Server streaming not supported in Wails target transport");
  }

  clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): ClientStreamingCall<I, O> {
    throw new Error("Client streaming not supported in Wails target transport");
  }

  duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
    throw new Error("Duplex streaming not supported in Wails target transport");
  }

  /**
   * Call Wails Target function and handle the response
   */
  private callWailsTarget<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions,
  ): { response: Promise<O>; status: Promise<RpcStatus>; trailers: Promise<RpcMetadata> } {
    console.log("WailsTargetTransport calling method:", method.name, "target:", this.targetUrl);

    const responsePromise = this.executeTargetCall(method, input);
    const statusPromise = responsePromise.then(() => ({ code: "OK", detail: "" }));
    const trailersPromise = responsePromise.then(() => ({}));

    return {
      response: responsePromise,
      status: statusPromise,
      trailers: trailersPromise,
    };
  }

  private async executeTargetCall<I extends object, O extends object>(method: MethodInfo<I, O>, input: I): Promise<O> {
    try {
      console.log("Executing Wails target call for method:", method.name);
      console.log("Target URL:", this.targetUrl);
      console.log("Input object:", input);

      // Serialize input using protobuf-ts
      const inputBytes = method.I.toBinary(input, { writeUnknownFields: false });
      console.log("Serialized inputBytes length:", inputBytes.length);

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

      // Construct the full method path: ServiceName/MethodName
      const fullMethodPath = `${method.service.typeName}/${method.name}`;
      console.log("Calling Wails Target with method:", fullMethodPath);

      // Call Wails Target function
      const responseArray = await Target(this.targetUrl, fullMethodPath, inputArray);

      console.log("Wails Target result length:", responseArray?.length);
      console.log("Wails Target result:", responseArray);

      // Convert response array back to Uint8Array
      const responseBytes = new Uint8Array(responseArray);
      const output = method.O.fromBinary(responseBytes);
      console.log("Wails Target output:", output);
      return output;
    } catch (error) {
      console.error("WailsTargetTransport error:", error);
      throw new Error(`Wails target transport error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}