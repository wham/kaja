import type { Call, CallOptions, Input } from "kaja";

export interface EmptyRequest {}

export interface EmptyResponse {}

/**
 * Test that __proto__ and _transport are properly escaped
 * These need to match the reserved names AFTER lowerCamelCase transformation
 */
export declare const TestService: {
    /**
     * After lowerCamelCase, this becomes "__proto__" which is reserved
     * Wait, that won't work because underscores are stripped...
     * Let me try a different approach: names that are ALREADY in lowercase
     */
    __proto__(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    /**
     * After lowerCamelCase, becomes "_transport" which is reserved
     */
    _transport(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
    /**
     * Normal method for comparison
     */
    GetData(input: Input<EmptyRequest>, options?: CallOptions): Call<EmptyResponse>;
};
