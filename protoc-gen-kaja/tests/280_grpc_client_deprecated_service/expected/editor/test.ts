import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    q: string;
}

export interface Resp {
    r: string;
}

/**
 * A deprecated service.
 *
 * @deprecated
 */
export declare const MySvc: {
    /**
     * This method is explicitly deprecated.
     *
     * @deprecated
     */
    DoIt(input: Input<Req>, options?: CallOptions): Call<Resp>;
    /**
     * This method is NOT deprecated itself.
     */
    OtherMethod(input: Input<Req>, options?: CallOptions): Call<Resp>;
};
