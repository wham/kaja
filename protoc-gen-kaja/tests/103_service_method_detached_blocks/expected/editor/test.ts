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
     * Method comment.
     */
    DoSomething(input: Input<Request>, options?: CallOptions): Call<Response>;
};
