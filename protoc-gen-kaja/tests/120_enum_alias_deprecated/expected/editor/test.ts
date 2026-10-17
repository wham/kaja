export interface Task {
    status: Status;
}

/**
 * Enum where alias is deprecated but original is not
 */
export enum Status {
    /**
     * Active status
     */
    ACTIVE = 0,
    /**
     * Running status
     */
    RUNNING = 1,
    /**
     * Alias for RUNNING, but deprecated
     *
     * @deprecated
     */
    STARTED = 1,
    STOPPED = 2,
}
