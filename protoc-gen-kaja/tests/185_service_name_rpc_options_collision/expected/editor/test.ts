import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Service named RpcOptions — collides with import type { RpcOptions } from runtime-rpc
 */
export declare const RpcOptions: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
