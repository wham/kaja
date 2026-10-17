import type { Call, CallOptions, Input } from "kaja";

/**
 * Leading comment with trailing spaces
 */
export interface Foo {
    /**
     * Field comment with trailing spaces
     */
    name: string;
}

/**
 * Service leading with trailing spaces
 */
export declare const MyService: {
    /**
     * Method comment with trailing spaces
     */
    DoStuff(input: Input<Foo>, options?: CallOptions): Call<Foo>;
};
