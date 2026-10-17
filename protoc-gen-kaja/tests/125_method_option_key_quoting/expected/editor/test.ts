import type { Call, CallOptions, Input } from "kaja";

export interface Req {
    query: string;
}

export interface Res {
    result: string;
}

export declare const MyAPI: {
    Search(input: Input<Req>, options?: CallOptions): Call<Res>;
};
