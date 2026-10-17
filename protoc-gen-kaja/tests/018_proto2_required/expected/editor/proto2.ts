/**
 * Test proto2 with required fields
 */
export interface RequiredFields {
    name: string;
    id: number;
    email?: string;
    age?: number;
    tags: string[];
}

/**
 * Test proto2 with default values
 */
export interface DefaultValues {
    name?: string;
    count?: number;
    enabled?: boolean;
    rate?: number;
    color?: Color;
}

/**
 * Test proto2 groups (deprecated but valid)
 */
export interface WithGroup {
    id?: number;
}

export interface WithGroup_Result {
    url: string;
    title?: string;
}

/**
 * Test proto2 extensions
 */
export interface Extendable {
    name?: string;
}

/**
 * Test nested enums in proto2
 */
export interface Container {
    status?: Container_Status;
    value?: number;
}

export enum Container_Status {
    UNKNOWN = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

export enum Color {
    RED = 0,
    GREEN = 1,
    BLUE = 2,
}
