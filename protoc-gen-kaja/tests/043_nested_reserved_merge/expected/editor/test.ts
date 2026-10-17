import type { Call, CallOptions, Input } from "kaja";

/**
 * This nested message should produce "String_" type after merging
 */
export interface String$ {}

export interface String__ {
    value: number;
}

/**
 * This should produce "Array_Value" after merging (not reserved)
 */
export interface Array$ {}

export interface Array_Value {
    data: string;
}

/**
 * This creates "Number_" after merging (reserved!)
 */
export interface Number$ {}

export interface Number__ {
    x: number;
}

/**
 * Test with deeply nested: "Boolean_True_"
 */
export interface Boolean$ {}

export interface Boolean_True {}

export interface Boolean_True__ {
    flag: boolean;
}

/**
 * Service names also go through createLocalTypeName
 */
export declare const Object: {
    DoSomething(input: Input<String$>, options?: CallOptions): Call<String$>;
};
