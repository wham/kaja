/**
 * When Timestamp is present, the plugin imports PbLong from runtime.
 * A local message named PbLong should cause a collision that needs aliasing.
 */
export interface Timestamp {
    seconds: string;
    nanos: number;
}

export interface PbLong {
    value: string;
}
