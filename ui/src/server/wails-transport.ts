import type { 
  MethodInfo, 
  RpcOptions, 
  RpcTransport, 
  UnaryCall,
  ServerStreamingCall,
  ClientStreamingCall,
  DuplexStreamingCall,
  RpcStatus,
  RpcMetadata
} from "@protobuf-ts/runtime-rpc";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import type { CompileRequest, GetConfigurationRequest } from "./api";

// Type definitions for Wails bindings
declare global {
  interface Window {
    runtime?: any;
    go?: {
      main?: {
        App?: {
          CompileRPC(ctx: any, req: any): Promise<any>;
          GetConfiguration(ctx: any, req: any): Promise<any>;
        };
      };
    };
  }
}

/**
 * Wails transport for protobuf-ts that uses Wails bindings instead of HTTP fetch
 */
export class WailsTransport implements RpcTransport {
  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return {
      ...options,
    };
  }

  unary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): UnaryCall<I, O> {
    const promise = this.callWailsMethod(method, input, options);
    const responsePromise = promise.then(result => result.response);
    const statusPromise = promise.then(result => result.status);
    
    const call = {
      method,
      requestHeaders: {} as RpcMetadata,
      request: input,
      headers: promise.then(() => ({} as RpcMetadata)),
      response: responsePromise,
      status: statusPromise,
      trailers: promise.then(() => ({} as RpcMetadata)),
      then: responsePromise.then.bind(responsePromise),
      promiseFinished: promise.then(() => undefined),
    };
    
    return call as unknown as UnaryCall<I, O>;
  }

  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): ServerStreamingCall<I, O> {
    throw new Error("Server streaming not supported in Wails transport");
  }

  clientStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions
  ): ClientStreamingCall<I, O> {
    throw new Error("Client streaming not supported in Wails transport");
  }

  duplex<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions
  ): DuplexStreamingCall<I, O> {
    throw new Error("Duplex streaming not supported in Wails transport");
  }

  private async callWailsMethod<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): Promise<{ response: O; status: RpcStatus }> {
    console.log('WailsTransport.callWailsMethod called with:', {
      methodName: method.name,
      input,
      hasRuntime: !!window.runtime,
      hasGoBindings: !!window.go?.main?.App
    });
    
    try {
      if (!window.runtime || !window.go?.main?.App) {
        const error = `Wails bindings not available: runtime=${!!window.runtime}, go=${!!window.go?.main?.App}`;
        console.error(error);
        throw new Error(error);
      }

      let result: any;
      
      // Route to the appropriate Wails method based on the RPC method name
      if (method.name === "Compile") {
        const req = input as CompileRequest;
        // Transform to the format expected by the Wails binding
        const wailsRequest = {
          log_offset: req.logOffset || 0,
          force: req.force || false,
          project_name: req.projectName || "",
          workspace: req.workspace || "",
        };
        console.log('Calling CompileRPC with:', wailsRequest);
        result = await window.go.main.App.CompileRPC(null, wailsRequest);
      } else if (method.name === "GetConfiguration") {
        console.log('Calling GetConfiguration');
        result = await window.go.main.App.GetConfiguration(null, {});
      } else {
        const error = `Unknown method: ${method.name}`;
        console.error(error);
        throw new Error(error);
      }

      console.log('Wails method result:', result);
      return {
        response: result as O,
        status: {
          code: "OK",
          detail: "",
        },
      };
    } catch (error) {
      console.error('WailsTransport error:', error);
      throw new RpcError(
        error instanceof Error ? error.message : "Unknown error",
        "UNKNOWN",
        {} as RpcMetadata
      );
    }
  }
}