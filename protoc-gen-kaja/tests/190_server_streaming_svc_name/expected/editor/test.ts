import type { Call, CallOptions, Input } from "kaja";

export interface Request {}

export interface Response {}

export declare const ServerStreamingCall: {
    Search(input: Input<Request>, options?: CallOptions): Call<Response>;
};
