import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { MethodCall } from "./kaja";
import { Client, Service } from "./project";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { Stub } from "./sources";

function isWailsEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).runtime !== "undefined" &&
    typeof (window as any).go !== "undefined" &&
    typeof (window as any).go.main !== "undefined" &&
    typeof (window as any).go.main.App !== "undefined"
  );
}

export function createClient(service: Service, stub: Stub, configuration: ConfigurationProject): Client {
  const client: Client = { methods: {} };

  let transport;
  if (isWailsEnvironment()) {
    console.log("Creating client in Wails environment - using WailsTransport in target mode");

    if (configuration.protocol == RpcProtocol.GRPC) {
      console.warn("gRPC protocol not fully supported in Wails environment");
      // Still create the transport but calls will fail with a meaningful error
    }

    // Use Wails transport in target mode for external API calls
    transport = new WailsTransport({ mode: "target", targetUrl: configuration.url });
  } else {
    transport =
      configuration.protocol == RpcProtocol.GRPC
        ? new GrpcWebFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          })
        : new TwirpFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          });
  }

  const clientStub = new stub[service.name + "Client"](transport);
  const options: RpcOptions = {
    interceptors: [
      {
        // adds X-Target header for web environment (not needed in Wails)
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          if (!isWailsEnvironment()) {
            options.meta["X-Target"] = configuration.url;
          }
          return next(method, input, options);
        },
      },
    ],
  };

  for (const method of service.methods) {
    client.methods[method.name] = async (input: any) => {
      const methodCall: MethodCall = {
        service,
        method,
        input,
      };
      client.kaja?._internal.methodCallUpdate(methodCall);

      try {
        let { response } = await clientStub[lcfirst(method.name)](input, options);
        methodCall.output = response;
      } catch (error) {
        methodCall.error = error;
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
