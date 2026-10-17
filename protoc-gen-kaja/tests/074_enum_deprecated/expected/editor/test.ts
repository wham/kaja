export interface Task {
    status: Status;
    priority: Priority;
}

/**
 * Deprecated enum
 *
 * @deprecated
 */
export enum Status {
    UNSPECIFIED = 0,
    ACTIVE = 1,
    INACTIVE = 2,
}

/**
 * Enum with deprecated values
 */
export enum Priority {
    PRIORITY_UNSPECIFIED = 0,
    /**
     * @deprecated
     */
    LOW = 1,
    MEDIUM = 2,
    /**
     * @deprecated
     */
    HIGH = 3,
}
