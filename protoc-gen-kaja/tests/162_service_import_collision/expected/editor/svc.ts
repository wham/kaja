import type { Call, CallOptions, Input } from "kaja";
import type { Data } from "./alpha";
import type { Data as Data$ } from "./beta";

export declare const MyService: {
    GetAlpha(input: Input<Data>, options?: CallOptions): Call<Data$>;
};
