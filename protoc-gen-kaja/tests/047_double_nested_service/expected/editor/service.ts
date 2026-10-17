import type { Call, CallOptions, Input } from "kaja";
import type { Outer_Middle_Inner, Outer_Middle } from "./types";

export declare const TestService: {
    /**
     * Uses doubly-nested type
     */
    DoSomething(input: Input<Outer_Middle_Inner>, options?: CallOptions): Call<Outer_Middle_Inner>;
    /**
     * Uses singly-nested type
     */
    DoAnother(input: Input<Outer_Middle>, options?: CallOptions): Call<Outer_Middle>;
};
