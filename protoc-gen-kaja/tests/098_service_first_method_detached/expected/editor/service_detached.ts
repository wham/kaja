import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

/**
 * Service comment.
 */
export declare const TestService: {
    /**
     * First method comment.
     */
    First(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Second method comment.
     */
    Second(input: Input<Request>, options?: CallOptions): Call<Response>;
};
