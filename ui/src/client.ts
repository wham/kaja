import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { MethodCall, MethodCallHttp } from "./kaja";
import { Client, ProjectRef, Service, Method, serviceId } from "./project";
import { RpcProtocol } from "./server/api";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { Stub } from "./sources";
import { isWailsEnvironment } from "./wails";

function buildHttpInfo(service: Service, method: Method, projectRef: ProjectRef): MethodCallHttp {
  const baseUrl = projectRef.configuration.url.replace(/\/$/, "");
  const fullServiceName = serviceId(service);
  const protocol = projectRef.configuration.protocol;

  let path: string;
  if (protocol === RpcProtocol.TWIRP) {
    path = `/twirp/${fullServiceName}/${method.name}`;
  } else {
    path = `/${fullServiceName}/${method.name}`;
  }

  return {
    method: "POST",
    url: baseUrl + path,
  };
}

export function createClient(service: Service, stub: Stub, projectRef: ProjectRef): Client {
  const client: Client = { methods: {} };

  if (projectRef.configuration.protocol === RpcProtocol.UNSPECIFIED) {
    throw new Error(`Project has no protocol specified. Set protocol to RPC_PROTOCOL_GRPC or RPC_PROTOCOL_TWIRP.`);
  }

  let transport;
  if (isWailsEnvironment()) {
    console.log("Creating client in Wails environment - using WailsTransport in target mode");
    // Use Wails transport in target mode for external API calls (supports both Twirp and gRPC)
    // Pass projectRef so URL and headers are read dynamically at request time
    transport = new WailsTransport({
      mode: "target",
      projectRef,
      protocol: projectRef.configuration.protocol,
    });
  } else {
    transport =
      projectRef.configuration.protocol === RpcProtocol.GRPC
        ? new GrpcWebFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          })
        : new TwirpFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          });
  }

  const ClientClass = stub[service.clientStubModuleId]?.[service.name + "Client"];
  const clientStub = new ClientClass(transport);
  const options: RpcOptions = {
    interceptors: [
      {
        // adds X-Target header and configured headers for web environment
        // Reads from projectRef dynamically at request time
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          if (!isWailsEnvironment()) {
            options.meta["X-Target"] = projectRef.configuration.url;
            // Pass configured headers with X-Header- prefix for the backend to forward
            const headers = projectRef.configuration.headers || {};
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
    client.methods[method.name] = async (input: any) => {
      // Capture request headers from projectRef at request time
      const requestHeaders: { [key: string]: string } = { ...(projectRef.configuration.headers || {}) };

      const methodCall: MethodCall = {
        service,
        method,
        input,
        requestHeaders,
        http: buildHttpInfo(service, method, projectRef),
      };
      client.kaja?._internal.methodCallUpdate(methodCall);

      try {
        const call = clientStub[lcfirst(method.name)](input, options);
        const [response, headers, trailers] = await Promise.all([call.response, call.headers, call.trailers]);
        methodCall.output = response;

        // Capture response headers and trailers
        const responseHeaders: { [key: string]: string } = {};
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            responseHeaders[key] = String(value);
          }
        }
        if (trailers) {
          for (const [key, value] of Object.entries(trailers)) {
            responseHeaders[key] = String(value);
          }
        }
        methodCall.responseHeaders = responseHeaders;

        // Mark successful response
        if (methodCall.http) {
          methodCall.http.status = 200;
          methodCall.http.statusText = "OK";
        }
      } catch (error: any) {
        methodCall.error = error;

        // Try to extract HTTP status from error
        if (methodCall.http && error) {
          const status = error.status ?? error.code ?? error.httpStatus;
          if (typeof status === "number") {
            methodCall.http.status = status;
            methodCall.http.statusText = error.statusText ?? error.message ?? httpStatusText(status);
          } else if (typeof status === "string" && /^\d+$/.test(status)) {
            methodCall.http.status = parseInt(status, 10);
            methodCall.http.statusText = error.statusText ?? error.message ?? httpStatusText(methodCall.http.status);
          }
        }
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

function httpStatusText(status: number): string {
  const statusTexts: { [key: number]: string } = {
    200: "OK",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    409: "Conflict",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return statusTexts[status] || "Error";
}
