import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    name: string;
}

export interface Res {
    result: string;
}

/**
 * Leading comment on service
 *
 * Trailing comment on service
 */
export declare const MyService: {
    /**
     * Leading comment on method
     *
     * Trailing comment on method
     */
    DoSomething(input: Input<Req>, options?: CallOptions): Call<Res>;
};
