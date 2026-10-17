import type { Call, CallOptions, Input } from "kaja";
import type { Container_String, Container_Array, Container_Number, Boolean$ } from "./types";

/**
 * Service using nested reserved types from another package
 */
export declare const NestedTypeService: {
    /**
     * Uses nested String from Container
     */
    GetString(input: Input<Container_String>, options?: CallOptions): Call<Container_String>;
    /**
     * Uses nested Array from Container
     */
    GetArray(input: Input<Container_Array>, options?: CallOptions): Call<Container_Array>;
    /**
     * Uses nested Number from Container
     */
    GetNumber(input: Input<Container_Number>, options?: CallOptions): Call<Container_Number>;
    /**
     * Uses top-level Boolean
     */
    GetBoolean(input: Input<Boolean$>, options?: CallOptions): Call<Boolean$>;
    /**
     * Mix of nested and top-level
     */
    Transform(input: Input<Container_String>, options?: CallOptions): Call<Boolean$>;
};
