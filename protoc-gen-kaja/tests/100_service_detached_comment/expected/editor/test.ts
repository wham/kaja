import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

/**
 * The actual service comment.
 */
export declare const TestService: {
    /**
     * First method
     */
    DoSomething(input: Input<Request>, options?: CallOptions): Call<Response>;
};
