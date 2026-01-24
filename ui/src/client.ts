import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { MethodCall } from "./kaja";
import { Client, Service } from "./project";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { findInStub, Stub } from "./sources";
import { isWailsEnvironment } from "./wails";

export function createClient(service: Service, stub: Stub, configuration: ConfigurationProject): Client {
  const client: Client = { methods: {} };

  if (configuration.protocol === RpcProtocol.UNSPECIFIED) {
    throw new Error(`Project "${configuration.name}" has no protocol specified. Set protocol to RPC_PROTOCOL_GRPC or RPC_PROTOCOL_TWIRP.`);
  }

  let transport;
  if (isWailsEnvironment()) {
    console.log("Creating client in Wails environment - using WailsTransport in target mode");
    // Use Wails transport in target mode for external API calls (supports both Twirp and gRPC)
    transport = new WailsTransport({
      mode: "target",
      targetUrl: configuration.url,
      protocol: configuration.protocol,
      headers: configuration.headers,
    });
  } else {
    transport =
      configuration.protocol === RpcProtocol.GRPC
        ? new GrpcWebFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          })
        : new TwirpFetchTransport({
            baseUrl: getBaseUrlForTarget(),
          });
  }

  const ClientClass = findInStub(stub, service.name + "Client");
  const clientStub = new ClientClass(transport);
  const options: RpcOptions = {
    interceptors: [
      {
        // adds X-Target header and configured headers for web environment
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          if (!isWailsEnvironment()) {
            options.meta["X-Target"] = configuration.url;
            // Pass configured headers with X-Header- prefix for the backend to forward
            if (configuration.headers) {
              for (const [key, value] of Object.entries(configuration.headers)) {
                options.meta["X-Header-" + key] = value;
              }
            }
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
