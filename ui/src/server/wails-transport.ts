import type { RpcTransport, MethodInfo, RpcOptions, UnaryCall, ServerStreamingCall, ClientStreamingCall, DuplexStreamingCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";

// Type definitions for Wails bindings
declare global {
  interface Window {
    runtime?: any;
    go?: {
      main?: {
        App?: {
          HandleTwirpRequest(ctx: any, method: string, body: string): Promise<string>;
        };
      };
    };
  }
}

/**
 * Lightweight Wails transport that wraps TwirpFetchTransport and replaces
 * the HTTP layer with Wails bindings while keeping Twirp protocol internals
 */
export class WailsTransport implements RpcTransport {
  private twirpTransport: TwirpFetchTransport;

  constructor() {
    // Create a TwirpFetchTransport but we'll override its fetch implementation
    this.twirpTransport = new TwirpFetchTransport({
      baseUrl: "", // Not used since we override fetch
    });

    // Override the fetch function to use Wails bindings instead of HTTP
    (this.twirpTransport as any).fetchResponse = this.wailsFetch.bind(this);
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return this.twirpTransport.mergeOptions(options);
  }

  unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): UnaryCall<I, O> {
    return this.twirpTransport.unary(method, input, options);
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
   * Custom fetch implementation that routes Twirp requests to Wails bindings
   */
  private async wailsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    console.log("WailsTransport.wailsFetch called with:", { input, init });

    try {
      if (!window.runtime || !window.go?.main?.App) {
        const error = `Wails bindings not available: runtime=${!!window.runtime}, go=${!!window.go?.main?.App}`;
        console.error(error);
        throw new Error(error);
      }

      // Extract method name from Twirp URL path
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body;

      if (!body) {
        throw new Error("No request body found");
      }

      // Extract method name from Twirp URL (format: /twirp/package.Service/Method)
      const urlPath = new URL(url, "http://localhost").pathname;
      const pathParts = urlPath.split("/");
      const methodName = pathParts[pathParts.length - 1];

      if (!methodName) {
        throw new Error(`Could not extract method name from URL: ${url}`);
      }

      console.log("Calling Wails HandleTwirpRequest with method:", methodName);

      // Pass the method name and raw request body to Wails
      const responseBody = await window.go.main.App.HandleTwirpRequest({}, methodName, body.toString());

      console.log("Wails HandleTwirpRequest result:", responseBody);

      // Return the response as-is from the backend
      return new Response(responseBody, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      console.error("WailsTransport error:", error);

      // Return error response in Twirp error format
      const twirpError = {
        code: "internal",
        msg: error instanceof Error ? error.message : "Unknown error",
        meta: {},
      };

      return new Response(JSON.stringify(twirpError), {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }
}
