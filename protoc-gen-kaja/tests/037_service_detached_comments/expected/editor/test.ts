import type { Call, CallOptions, Input } from "kaja";

export interface Request {
    id: string;
}

export interface Response {
    result: string;
}

/**
 * Service with detached comments between methods
 */
export declare const TestService: {
    /**
     * Comment for first method
     */
    First(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Comment for second method
     */
    Second(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Comment for third method
     */
    Third(input: Input<Request>, options?: CallOptions): Call<Response>;
};
