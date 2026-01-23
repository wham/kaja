import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { MethodCall } from "./kaja";
import { Client, Service } from "./project";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { getBaseUrlForTarget } from "./server/connection";
import { WailsTransport } from "./server/wails-transport";
import { Stub } from "./sources";
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
    transport = new WailsTransport({ mode: "target", targetUrl: configuration.url, protocol: configuration.protocol });
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
