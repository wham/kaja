/**
 * Outer message has field 1 with a specific comment
 */
export interface Outer {
    /**
     * This is the outer name field
     */
    name: string;
    inner?: Outer_Inner;
}

/**
 * Nested message with a oneof
 */
export interface Outer_Inner {
    choice: {
        oneofKind: "text";
        /**
         * This is the inner string choice
         */
        text: string;
    } | {
        oneofKind: "number";
        /**
         * This is the inner int choice
         */
        number: number;
    } | {
        oneofKind: undefined;
    };
}

/**
 * Second top-level message (needed so msgIndex=1 doesn't panic)
 */
export interface Other {
    value: string;
}
