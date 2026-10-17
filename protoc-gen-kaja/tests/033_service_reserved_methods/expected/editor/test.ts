import type { Call, CallOptions, Input } from "kaja";

export interface Request {}

export interface Response {}

/**
 * Test service with methods that are reserved class properties
 */
export declare const TestService: {
    /**
     * These method names are reserved class properties and should be escaped
     */
    Name(input: Input<Request>, options?: CallOptions): Call<Response>;
    Constructor(input: Input<Request>, options?: CallOptions): Call<Response>;
    Close(input: Input<Request>, options?: CallOptions): Call<Response>;
    ToString(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Normal method for comparison
     */
    GetData(input: Input<Request>, options?: CallOptions): Call<Response>;
};
