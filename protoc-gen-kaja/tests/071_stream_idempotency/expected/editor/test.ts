import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

export declare const TestService: {
    /**
     * Server streaming with idempotency - is this allowed?
     */
    StreamWithIdempotency(input: Input<Request>, options?: CallOptions): Call<Response>;
};
