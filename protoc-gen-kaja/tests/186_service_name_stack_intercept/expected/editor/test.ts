import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Service named stackIntercept — collides with import { stackIntercept } from runtime-rpc
 */
export declare const stackIntercept: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
