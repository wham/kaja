import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    q: string;
}

export interface Resp {
    r: string;
}

/**
 * The TS plugin generates a .server.ts file for GENERIC_SERVER.
 * The Go plugin has no GENERIC_SERVER support and won't generate it.
 */
export declare const MySvc: {
    DoIt(input: Input<Req>, options?: CallOptions): Call<Resp>;
};
