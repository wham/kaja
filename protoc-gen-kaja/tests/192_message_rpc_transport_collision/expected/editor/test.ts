import type { Call, CallOptions, Input } from "kaja";

/**
 * Message named RpcTransport collides with runtime-rpc import in client file
 */
export interface RpcTransport {
    data: string;
}

export interface Response {
    result: string;
}

export declare const Searcher: {
    Search(input: Input<RpcTransport>, options?: CallOptions): Call<Response>;
};
