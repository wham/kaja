export interface Container {
    /**
     * Map using the nested enum as value
     */
    arrays: { [key: string]: Container_Array };
}

/**
 * Nested enum with reserved type name
 */
export enum Container_Array {
    UNKNOWN = 0,
    FIRST = 1,
    SECOND = 2,
}
