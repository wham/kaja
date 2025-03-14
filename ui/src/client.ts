import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { RpcOptions, UnaryCall } from "@protobuf-ts/runtime-rpc";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { MethodCall } from "./kaja";
import { Client, Service } from "./project";
import { ConfigurationProject, RpcProtocol } from "./server/api";
import { getBaseUrlForTarget } from "./server/connection";
import { Stub } from "./sources";

export function createClient(service: Service, stub: Stub, configuration: ConfigurationProject): Client {
  const client: Client = { methods: {} };
  const transport =
    configuration.protocol == RpcProtocol.GRPC
      ? new GrpcWebFetchTransport({
          baseUrl: getBaseUrlForTarget(),
        })
      : new TwirpFetchTransport({
          baseUrl: getBaseUrlForTarget(),
        });
  const clientStub = new stub[service.name + "Client"](transport);
  const options: RpcOptions = {
    interceptors: [
      {
        // adds auth header to unary requests
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          options.meta["X-Target"] = configuration.url;
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
