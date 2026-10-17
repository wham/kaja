export interface Container {
    status: Status;
}

/**
 * Tests that enum value comments with trailing blank lines
 * are handled correctly (sentinel should not leak).
 */
export enum Status {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    /**
     * Stopped by user.
     */
    STOPPED = 2,
}
