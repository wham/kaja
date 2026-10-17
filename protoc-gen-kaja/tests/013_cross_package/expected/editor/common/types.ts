/**
 * Common types shared across packages
 */
export interface Timestamp {
    seconds: string;
    nanos: number;
}

export interface Address {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
}

export enum Status {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    INACTIVE = 2,
    DELETED = 3,
}
