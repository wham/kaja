export interface Test {
    status?: Status;
}

/**
 * Proto2 allows enums without 0
 */
export enum Status {
    UNSPECIFIED$ = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}
