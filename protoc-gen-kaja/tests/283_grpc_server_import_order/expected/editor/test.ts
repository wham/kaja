import type { Call, CallOptions, Input } from "kaja";
import type { Empty } from "./google/protobuf/empty";
import type { Timestamp } from "./google/protobuf/timestamp";

export interface Req {
    q: string;
}

export declare const MySvc: {
    GetTime(input: Input<Empty>, options?: CallOptions): Call<Timestamp>;
    SetTime(input: Input<Timestamp>, options?: CallOptions): Call<Empty>;
    DoIt(input: Input<Req>, options?: CallOptions): Call<Req>;
};
