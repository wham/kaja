import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { MethodCall } from "./kaja";
import { Client, Service } from "./project";
import { getBaseUrlForTarget } from "./server/connection";
import { Stub } from "./sources";

export function createClient(service: Service, stub: Stub): Client {
  const client: Client = { methods: {} };
  const transport = new GrpcWebFetchTransport({
    baseUrl: getBaseUrlForTarget(),
  });
  const clientStub = new stub[service.name + "Client"](transport);

  for (const method of service.methods) {
    client.methods[method.name] = async (input: any) => {
      const methodCall: MethodCall = {
        service,
        method,
        input,
      };
      client.kaja?._internal.methodCallUpdate(methodCall);

      try {
        let { response } = await clientStub[lcfirst(method.name)](input);
        methodCall.output = response;
      } catch (error) {
        methodCall.error = error;
      }

      client.kaja?._internal.methodCallUpdate(methodCall);
    };
  }

  return client;
}

function lcfirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
