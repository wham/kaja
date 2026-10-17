export interface MyOptions {
    priority: Priority;
}

export interface TestMessage {
    /**
     * Use value 0, which maps to both PRIORITY_LOW and PRIORITY_DEFAULT
     */
    name: string;
    /**
     * Use value 1, which maps to both PRIORITY_MEDIUM and PRIORITY_NORMAL
     */
    description: string;
}

/**
 * Enum with allow_alias: two names map to the same numeric value.
 */
export enum Priority {
    LOW = 0,
    /**
     * alias for LOW
     */
    DEFAULT = 0,
    MEDIUM = 1,
    /**
     * alias for MEDIUM
     */
    NORMAL = 1,
    HIGH = 2,
}
