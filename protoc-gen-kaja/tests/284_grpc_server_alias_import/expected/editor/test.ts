import type { Call, CallOptions, Input } from "kaja";
import type { Response } from "./types_a";
import type { Response as Response$ } from "./types_b";

export interface Req {
    query: string;
}

export declare const MySvc: {
    GetAlpha(input: Input<Req>, options?: CallOptions): Call<Response>;
    GetBeta(input: Input<Req>, options?: CallOptions): Call<Response$>;
};
