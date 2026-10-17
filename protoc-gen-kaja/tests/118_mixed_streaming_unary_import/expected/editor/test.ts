import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    name: string;
}

export interface Res {
    result: string;
}

export declare const MixedService: {
    Watch(input: Input<Req>, options?: CallOptions): Call<Res>;
    Do(input: Input<Req>, options?: CallOptions): Call<Res>;
};
