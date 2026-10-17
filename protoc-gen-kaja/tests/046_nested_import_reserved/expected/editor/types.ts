/**
 * Outer message with nested reserved type names
 */
export interface Container {
    /**
     * A field using one of the nested types
     */
    str?: Container_String;
    arr?: Container_Array;
}

/**
 * Nested message with a reserved TypeScript type name
 */
export interface Container_String {
    value: string;
}

/**
 * Another nested reserved name
 */
export interface Container_Array {
    items: string[];
}

/**
 * Nested Number
 */
export interface Container_Number {
    value: number;
}

/**
 * Top-level reserved type
 */
export interface Boolean$ {
    value: boolean;
}
