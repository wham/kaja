/**
 * A Timestamp represents a point in time.
 */
export interface Timestamp {
    seconds: string;
    nanos: number;
}

/**
 * This message name collides with the JsonWriteOptions TYPE import.
 */
export interface JsonWriteOptions {
    format: string;
    pretty: boolean;
}
