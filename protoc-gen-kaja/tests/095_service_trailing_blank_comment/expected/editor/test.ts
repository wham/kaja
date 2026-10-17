import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

/**
 * Service comment with trailing blank line.
 */
export declare const MyService: {
    /**
     * Method comment with trailing blank line.
     */
    DoSomething(input: Input<Request>, options?: CallOptions): Call<Response>;
};
