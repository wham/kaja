import type { Call, CallOptions, Input } from "kaja";

/**
 * A message named DuplexStreamingCall which collides with a runtime-rpc type
 * but only if duplex streaming is actually used.
 */
export interface DuplexStreamingCall {
    data: string;
}

export interface Response {
    result: string;
}

/**
 * This service only has unary methods, so DuplexStreamingCall is NOT imported from runtime-rpc.
 */
export declare const TestService: {
    DoSomething(input: Input<DuplexStreamingCall>, options?: CallOptions): Call<Response>;
};
