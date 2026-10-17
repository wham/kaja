/**
 * A message using the enum.
 */
export interface Msg {
    status: Status;
}

/**
 * A status enum.
 */
export enum Status {
    /**
     * This is a multiline
     * trailing comment
     * for unknown
     */
    UNKNOWN = 0,
    /**
     * single block trailing
     */
    ACTIVE = 1,
}
