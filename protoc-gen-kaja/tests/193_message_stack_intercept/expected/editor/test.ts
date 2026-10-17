import type { Call, CallOptions, Input } from "kaja";

/**
 * Message named stackIntercept collides with import { stackIntercept } from runtime-rpc
 */
export interface stackIntercept {
    data: string;
}

export interface Response {
    result: string;
}

export declare const TestService: {
    DoSomething(input: Input<stackIntercept>, options?: CallOptions): Call<Response>;
};
