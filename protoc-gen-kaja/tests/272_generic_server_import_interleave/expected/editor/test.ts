import type { Call, CallOptions, Input } from "kaja";

export interface Alpha {
    a: string;
}

export interface Beta {
    b: string;
}

export interface Gamma {
    g: string;
}

export interface Delta {
    d: string;
}

/**
 * GENERIC_SERVER with two server-streaming methods using different types.
 * The TS plugin prepends each import as it's encountered during code
 * generation. RpcInputStream is first encountered during StreamA, so it
 * sits between Gamma/Delta and Beta/Alpha imports. The Go plugin always
 * emits RpcInputStream at the top before all message types.
 */
export declare const MySvc: {
    StreamA(input: Input<Alpha>, options?: CallOptions): Call<Beta>;
    StreamB(input: Input<Gamma>, options?: CallOptions): Call<Delta>;
};
