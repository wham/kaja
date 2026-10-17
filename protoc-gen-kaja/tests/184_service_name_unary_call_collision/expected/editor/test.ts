import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Service named UnaryCall - collides with runtime-rpc UnaryCall import in client file.
 */
export declare const UnaryCall: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
