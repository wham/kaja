import type { Call, CallOptions, Input } from "kaja";

export interface Outer {}

export interface Outer_Middle {}

export interface Outer_Middle_Inner {}

export interface MyOption {
    deepValue: Outer_Middle_Inner_DeepEnum;
}

export interface Request {}

export interface Response {}

export enum Outer_Middle_Inner_DeepEnum {
    UNKNOWN = 0,
    VALUE_A = 1,
    VALUE_B = 2,
}

export declare const MyService: {
    Foo(input: Input<Request>, options?: CallOptions): Call<Response>;
};
