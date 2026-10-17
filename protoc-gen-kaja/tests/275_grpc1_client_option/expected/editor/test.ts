import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    q: string;
}

export interface Resp {
    r: string;
}

export declare const MySvc: {
    DoIt(input: Input<Req>, options?: CallOptions): Call<Resp>;
};
