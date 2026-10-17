import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    q: string;
}

export interface Resp {
    r: string;
}

/**
 * The TS plugin only hardcode-excludes "ts.client" from service options,
 * NOT "ts.server". So ts.server should appear in the generated output.
 */
export declare const MySvc: {
    DoIt(input: Input<Req>, options?: CallOptions): Call<Resp>;
};
