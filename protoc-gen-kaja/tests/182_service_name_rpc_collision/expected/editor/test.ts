import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Service named RpcTransport collides with runtime-rpc import
 */
export declare const RpcTransport: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
