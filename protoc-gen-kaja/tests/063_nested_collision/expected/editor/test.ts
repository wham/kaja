/**
 * Top-level message
 */
export interface Outer_Inner {
    value: string;
}

/**
 * Outer message with nested Inner (will collide with Outer_Inner)
 */
export interface Outer {
    inner?: Outer_Inner$1;
    outerInner?: Outer_Inner;
}

export interface Outer_Inner$1 {
    number: number;
}
