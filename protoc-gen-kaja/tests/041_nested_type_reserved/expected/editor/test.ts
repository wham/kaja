export interface Outer {
    nested?: Outer_constructor;
}

export interface Outer_constructor {
    value: string;
}

/**
 * Test top-level message with reserved type name
 */
export interface Array$ {
    value: string;
}
