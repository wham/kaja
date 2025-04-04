// @generated by protobuf-ts 2.9.4 with parameter generate_dependencies
// @generated from protobuf file "api.proto" (syntax proto3)
// tslint:disable
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { Api } from "./api";
import type { GetConfigurationResponse } from "./api";
import type { GetConfigurationRequest } from "./api";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { CompileResponse } from "./api";
import type { CompileRequest } from "./api";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * @generated from protobuf service Api
 */
export interface IApiClient {
  /**
   * @generated from protobuf rpc: Compile(CompileRequest) returns (CompileResponse);
   */
  compile(input: CompileRequest, options?: RpcOptions): UnaryCall<CompileRequest, CompileResponse>;
  /**
   * @generated from protobuf rpc: GetConfiguration(GetConfigurationRequest) returns (GetConfigurationResponse);
   */
  getConfiguration(input: GetConfigurationRequest, options?: RpcOptions): UnaryCall<GetConfigurationRequest, GetConfigurationResponse>;
}
/**
 * @generated from protobuf service Api
 */
export class ApiClient implements IApiClient, ServiceInfo {
  typeName = Api.typeName;
  methods = Api.methods;
  options = Api.options;
  constructor(private readonly _transport: RpcTransport) {}
  /**
   * @generated from protobuf rpc: Compile(CompileRequest) returns (CompileResponse);
   */
  compile(input: CompileRequest, options?: RpcOptions): UnaryCall<CompileRequest, CompileResponse> {
    const method = this.methods[0],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<CompileRequest, CompileResponse>("unary", this._transport, method, opt, input);
  }
  /**
   * @generated from protobuf rpc: GetConfiguration(GetConfigurationRequest) returns (GetConfigurationResponse);
   */
  getConfiguration(input: GetConfigurationRequest, options?: RpcOptions): UnaryCall<GetConfigurationRequest, GetConfigurationResponse> {
    const method = this.methods[1],
      opt = this._transport.mergeOptions(options);
    return stackIntercept<GetConfigurationRequest, GetConfigurationResponse>("unary", this._transport, method, opt, input);
  }
}
