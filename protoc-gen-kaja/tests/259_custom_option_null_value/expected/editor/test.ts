import type { NullValue } from "./google/protobuf/struct";

/**
 * Custom option message with a google.protobuf.NullValue enum field.
 * The TS runtime's ReflectionJsonWriter.enum() has special handling for NullValue:
 * it returns JSON `null` instead of the enum value name string.
 * The Go plugin has no special NullValue handling and outputs the enum name
 * as a quoted string: "NULL_VALUE".
 */
export interface NullOption {
    label?: string;
    nullField?: NullValue;
}

export interface Foo {
    /**
     * Set null_field to NULL_VALUE (enum value 0).
     * TS outputs: { label: "hello", nullField: null }
     * Go outputs: { label: "hello", nullField: "NULL_VALUE" }
     */
    name: string;
}
