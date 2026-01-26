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
import { Twirp, Target } from "../wailsjs/go/main/App";
import { RpcProtocol } from "./api";
import { ProjectRef } from "../project";

export type WailsTransportMode = "api" | "target";

export interface WailsTransportOptions {
  mode: WailsTransportMode;
  projectRef?: ProjectRef; // Dynamic project reference for "target" mode
  protocol: RpcProtocol;
}

/**
 * Unified Wails transport that implements RpcTransport for both internal API calls
 * and external target calls using Wails bindings instead of HTTP
 */
export class WailsTransport implements RpcTransport {
  private mode: WailsTransportMode;
  private projectRef?: ProjectRef;
  private protocol: number;

  constructor(options: WailsTransportOptions) {
    this.mode = options.mode;
    this.projectRef = options.projectRef;
    this.protocol = options.protocol;

    if (this.mode === "target" && !this.projectRef) {
      throw new Error("projectRef is required when mode is 'target'");
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
    throw new Error(`Server streaming not supported in Wails ${this.mode} transport`);
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
      this.mode === "target" ? `target: ${this.projectRef?.configuration.url}` : "",
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
        console.log("Target URL:", this.projectRef?.configuration.url);
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

      let responseArray: number[];

      if (this.mode === "api") {
        console.log("Calling Wails Twirp with method:", method.name);
        responseArray = await Twirp(method.name, inputArray);
      } else {
        // mode === "target" - read URL and headers dynamically from projectRef
        const fullMethodPath = `${method.service.typeName}/${method.name}`;
        const headersJson = JSON.stringify(this.projectRef!.configuration.headers || {});
        console.log("Calling Wails Target with method:", fullMethodPath, "protocol:", this.protocol, "headers:", headersJson);
        responseArray = await Target(this.projectRef!.configuration.url, fullMethodPath, inputArray, this.protocol, headersJson);
      }

      console.log(`Wails ${this.mode} result length:`, responseArray?.length);
      console.log(`Wails ${this.mode} result:`, responseArray);

      // Both API and Target modes use the same response handling (base64 decoding)
      const responseBytes = Uint8Array.from(atob(responseArray as unknown as string), (c) => c.charCodeAt(0));

      const output = method.O.fromBinary(responseBytes);
      console.log(`Wails ${this.mode} output:`, output);
      return output;
    } catch (error) {
      console.error(`Wails ${this.mode} transport error:`, error);
      throw new Error(`Wails ${this.mode} transport error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}
