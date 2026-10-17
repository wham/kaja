import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    query: string;
}

export interface Res {
    data: string;
}

export declare const StreamService: {
    Watch(input: Input<Req>, options?: CallOptions): Call<Res>;
    Follow(input: Input<Req>, options?: CallOptions): Call<Res>;
};
