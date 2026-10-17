import type { Call, CallOptions, Input } from "kaja";

export interface Request {}

export interface Response {}

/**
 * Test service where method names collide after escaping
 */
export declare const TestService: {
    /**
     * This becomes "name$" after escaping
     */
    Name(input: Input<Request>, options?: CallOptions): Call<Response>;
    /**
     * Let me try: constructor and Constructor$ (if allowed)
     */
    Constructor(input: Input<Request>, options?: CallOptions): Call<Response>;
};
