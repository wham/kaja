import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Service where the first method is streaming but a subsequent method is unary.
 * This tests that the UnaryCall import appears in the correct position
 * in the client file (before stackIntercept, not after streaming call types).
 */
export declare const StreamFirst: {
    Watch(input: Input<Request>, options?: CallOptions): Call<Response>;
    DoSomething(input: Input<Request>, options?: CallOptions): Call<Response>;
};
