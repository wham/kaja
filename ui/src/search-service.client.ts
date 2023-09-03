// @generated by protobuf-ts 2.9.1 with parameter long_type_string
// @generated from protobuf file "search-service.proto" (syntax proto3)
// tslint:disable
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { SearchService } from "./search-service";
import type { IndexResponse } from "./search-service";
import type { IndexRequest } from "./search-service";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { SearchResponse } from "./search-service";
import type { SearchRequest } from "./search-service";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * @generated from protobuf service SearchService
 */
export interface ISearchServiceClient {
    /**
     * @generated from protobuf rpc: Search(SearchRequest) returns (SearchResponse);
     */
    search(input: SearchRequest, options?: RpcOptions): UnaryCall<SearchRequest, SearchResponse>;
    /**
     * @generated from protobuf rpc: Index(IndexRequest) returns (IndexResponse);
     */
    index(input: IndexRequest, options?: RpcOptions): UnaryCall<IndexRequest, IndexResponse>;
}
/**
 * @generated from protobuf service SearchService
 */
export class SearchServiceClient implements ISearchServiceClient, ServiceInfo {
    typeName = SearchService.typeName;
    methods = SearchService.methods;
    options = SearchService.options;
    constructor(private readonly _transport: RpcTransport) {
    }
    /**
     * @generated from protobuf rpc: Search(SearchRequest) returns (SearchResponse);
     */
    search(input: SearchRequest, options?: RpcOptions): UnaryCall<SearchRequest, SearchResponse> {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept<SearchRequest, SearchResponse>("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: Index(IndexRequest) returns (IndexResponse);
     */
    index(input: IndexRequest, options?: RpcOptions): UnaryCall<IndexRequest, IndexResponse> {
        const method = this.methods[1], opt = this._transport.mergeOptions(options);
        return stackIntercept<IndexRequest, IndexResponse>("unary", this._transport, method, opt, input);
    }
}
