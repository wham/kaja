import type { Call, CallOptions, Input } from "kaja";

/**
 * Test proto3 optional fields (proto3.15+ feature)
 */
export interface OptionalFields {
    /**
     * Regular required fields (proto3 default)
     */
    requiredString: string;
    requiredInt: number;
    /**
     * Optional scalar fields
     */
    optionalString?: string;
    optionalInt?: number;
    optionalBool?: boolean;
    optionalDouble?: number;
    /**
     * Optional message field
     */
    optionalMessage?: Nested;
    /**
     * Optional enum field
     */
    optionalEnum?: Status;
    /**
     * Mix of optional and required
     */
    required2: string;
    optional2?: string;
    required3: number;
    optional3?: number;
}

export interface Nested {
    value: string;
}

/**
 * All optional fields
 */
export interface AllOptional {
    field1?: string;
    field2?: number;
    field3?: boolean;
    field4?: Uint8Array;
    field5?: Nested;
}

/**
 * Optional in nested message
 */
export interface Container {
    inner?: Container_Inner;
    optionalName?: string;
}

export interface Container_Inner {
    optionalValue?: string;
    requiredValue: string;
}

/**
 * Optional with oneof (edge case)
 */
export interface OptionalWithOneof {
    optionalField?: string;
    choice: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
    anotherOptional?: number;
}

export interface OptionalRequest {
    query?: string;
    limit?: number;
}

export interface OptionalResponse {
    result?: string;
    count?: number;
}

export enum Status {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

/**
 * Service using optional fields
 */
export declare const OptionalService: {
    GetData(input: Input<OptionalRequest>, options?: CallOptions): Call<OptionalResponse>;
};
