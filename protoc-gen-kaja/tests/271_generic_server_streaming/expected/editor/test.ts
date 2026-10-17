import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    q: string;
}

export interface Resp {
    r: string;
}

/**
 * GENERIC_SERVER with all four streaming types.
 * The TS plugin adds imports as they are encountered during code generation
 * (each prepended at the top of the file). The Go plugin emits message type
 * imports first, then runtime-rpc streaming imports, then ServerCallContext.
 * This causes the import order to differ.
 */
export declare const MySvc: {
    Unary(input: Input<Req>, options?: CallOptions): Call<Resp>;
    ServerStream(input: Input<Req>, options?: CallOptions): Call<Resp>;
};
