import { TwirpContext, TwirpServer, RouterEvents, TwirpError, TwirpErrorCode, Interceptor, TwirpContentType, chainInterceptors } from "twirp-ts";
import { BootstrapRequest, BootstrapResponse } from "./api";

//==================================//
//          Client Code             //
//==================================//

interface Rpc {
  request(service: string, method: string, contentType: "application/json" | "application/protobuf", data: object | Uint8Array): Promise<object | Uint8Array>;
}

export interface ApiClient {
  Bootstrap(request: BootstrapRequest): Promise<BootstrapResponse>;
}

export class ApiClientJSON implements ApiClient {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Bootstrap.bind(this);
  }
  Bootstrap(request: BootstrapRequest): Promise<BootstrapResponse> {
    const data = BootstrapRequest.toJson(request, { useProtoFieldName: true, emitDefaultValues: false });
    const promise = this.rpc.request("Api", "Bootstrap", "application/json", data as object);
    return promise.then((data) => BootstrapResponse.fromJson(data as any, { ignoreUnknownFields: true }));
  }
}

export class ApiClientProtobuf implements ApiClient {
  private readonly rpc: Rpc;
  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.Bootstrap.bind(this);
  }
  Bootstrap(request: BootstrapRequest): Promise<BootstrapResponse> {
    const data = BootstrapRequest.toBinary(request);
    const promise = this.rpc.request("Api", "Bootstrap", "application/protobuf", data);
    return promise.then((data) => BootstrapResponse.fromBinary(data as Uint8Array));
  }
}

//==================================//
//          Server Code             //
//==================================//

export interface ApiTwirp<T extends TwirpContext = TwirpContext> {
  Bootstrap(ctx: T, request: BootstrapRequest): Promise<BootstrapResponse>;
}

export enum ApiMethod {
  Bootstrap = "Bootstrap",
}

export const ApiMethodList = [ApiMethod.Bootstrap];

export function createApiServer<T extends TwirpContext = TwirpContext>(service: ApiTwirp<T>) {
  return new TwirpServer<ApiTwirp, T>({
    service,
    packageName: "",
    serviceName: "Api",
    methodList: ApiMethodList,
    matchRoute: matchApiRoute,
  });
}

function matchApiRoute<T extends TwirpContext = TwirpContext>(method: string, events: RouterEvents<T>) {
  switch (method) {
    case "Bootstrap":
      return async (ctx: T, service: ApiTwirp, data: Buffer, interceptors?: Interceptor<T, BootstrapRequest, BootstrapResponse>[]) => {
        ctx = { ...ctx, methodName: "Bootstrap" };
        await events.onMatch(ctx);
        return handleApiBootstrapRequest(ctx, service, data, interceptors);
      };
    default:
      events.onNotFound();
      const msg = `no handler found`;
      throw new TwirpError(TwirpErrorCode.BadRoute, msg);
  }
}

function handleApiBootstrapRequest<T extends TwirpContext = TwirpContext>(
  ctx: T,
  service: ApiTwirp,
  data: Buffer,
  interceptors?: Interceptor<T, BootstrapRequest, BootstrapResponse>[]
): Promise<string | Uint8Array> {
  switch (ctx.contentType) {
    case TwirpContentType.JSON:
      return handleApiBootstrapJSON<T>(ctx, service, data, interceptors);
    case TwirpContentType.Protobuf:
      return handleApiBootstrapProtobuf<T>(ctx, service, data, interceptors);
    default:
      const msg = "unexpected Content-Type";
      throw new TwirpError(TwirpErrorCode.BadRoute, msg);
  }
}
async function handleApiBootstrapJSON<T extends TwirpContext = TwirpContext>(
  ctx: T,
  service: ApiTwirp,
  data: Buffer,
  interceptors?: Interceptor<T, BootstrapRequest, BootstrapResponse>[]
) {
  let request: BootstrapRequest;
  let response: BootstrapResponse;

  try {
    const body = JSON.parse(data.toString() || "{}");
    request = BootstrapRequest.fromJson(body, { ignoreUnknownFields: true });
  } catch (e) {
    if (e instanceof Error) {
      const msg = "the json request could not be decoded";
      throw new TwirpError(TwirpErrorCode.Malformed, msg).withCause(e, true);
    }
  }

  if (interceptors && interceptors.length > 0) {
    const interceptor = chainInterceptors(...interceptors) as Interceptor<T, BootstrapRequest, BootstrapResponse>;
    response = await interceptor(ctx, request!, (ctx, inputReq) => {
      return service.Bootstrap(ctx, inputReq);
    });
  } else {
    response = await service.Bootstrap(ctx, request!);
  }

  return JSON.stringify(BootstrapResponse.toJson(response, { useProtoFieldName: true, emitDefaultValues: false }) as string);
}
async function handleApiBootstrapProtobuf<T extends TwirpContext = TwirpContext>(
  ctx: T,
  service: ApiTwirp,
  data: Buffer,
  interceptors?: Interceptor<T, BootstrapRequest, BootstrapResponse>[]
) {
  let request: BootstrapRequest;
  let response: BootstrapResponse;

  try {
    request = BootstrapRequest.fromBinary(data);
  } catch (e) {
    if (e instanceof Error) {
      const msg = "the protobuf request could not be decoded";
      throw new TwirpError(TwirpErrorCode.Malformed, msg).withCause(e, true);
    }
  }

  if (interceptors && interceptors.length > 0) {
    const interceptor = chainInterceptors(...interceptors) as Interceptor<T, BootstrapRequest, BootstrapResponse>;
    response = await interceptor(ctx, request!, (ctx, inputReq) => {
      return service.Bootstrap(ctx, inputReq);
    });
  } else {
    response = await service.Bootstrap(ctx, request!);
  }

  return Buffer.from(BootstrapResponse.toBinary(response));
}
