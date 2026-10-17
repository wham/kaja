import type { Call, CallOptions, Input } from "kaja";

export interface A {
    v: string;
}

export interface B {
    v: string;
}

export interface C {
    v: string;
}

export interface D {
    v: string;
}

/**
 * Service where first method is unary, and two subsequent methods
 * are both server-streaming. The Go plugin emits duplicate
 * ServerStreamingCall imports in the client file interleave branch.
 */
export declare const Svc: {
    Unary1(input: Input<A>, options?: CallOptions): Call<B>;
    Stream1(input: Input<C>, options?: CallOptions): Call<D>;
    Stream2(input: Input<A>, options?: CallOptions): Call<B>;
};
