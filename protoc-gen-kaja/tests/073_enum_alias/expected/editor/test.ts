export interface Task {
    status?: Status;
    priority?: Priority;
}

/**
 * Enum with allow_alias
 */
export enum Status {
    UNSPECIFIED = 0,
    /**
     * First value with number 1
     */
    STARTED = 1,
    /**
     * Alias for STARTED - should have different comment handling
     */
    RUNNING = 1,
    /**
     * Another distinct value
     */
    STOPPED = 2,
    /**
     * Alias for STOPPED
     */
    COMPLETED = 2,
    /**
     * Value with number 3
     */
    FAILED = 3,
}

/**
 * Another enum with aliases and comments
 */
export enum Priority {
    /**
     * This is the default priority
     */
    PRIORITY_UNSPECIFIED = 0,
    /**
     * Low priority tasks
     */
    LOW = 1,
    /**
     * Alias for low - should reference LOW not repeat the comment
     */
    MINOR = 1,
    /**
     * Medium priority
     */
    MEDIUM = 2,
    /**
     * Alias for medium
     */
    NORMAL = 2,
    /**
     * Another alias for medium
     */
    STANDARD = 2,
    /**
     * High priority
     */
    HIGH = 3,
    /**
     * Alias for high
     */
    URGENT = 3,
    CRITICAL = 3,
}
