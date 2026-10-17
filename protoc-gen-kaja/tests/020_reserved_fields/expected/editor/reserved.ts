/**
 * Test reserved field numbers
 */
export interface ReservedNumbers {
    field1: string;
    field5: string;
    field11: string;
}

/**
 * Test reserved field names
 */
export interface ReservedNames {
    currentField: string;
    anotherField: string;
}

/**
 * Test both reserved numbers and names
 */
export interface ReservedBoth {
    active: string;
    newField: string;
}

/**
 * Test reserved in nested messages
 */
export interface Container {
    id: string;
    nested?: Container_Nested;
}

export interface Container_Nested {
    value: string;
    newValue: string;
}

/**
 * Test reserved enum values
 */
export enum StatusWithReserved {
    STATUS_UNKNOWN = 0,
    STATUS_ACTIVE = 1,
    STATUS_PENDING = 5,
}
