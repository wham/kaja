/**
 * Timestamp triggers WKT code that imports typeofJsonValue from runtime
 */
export interface Timestamp {
    seconds: string;
    nanos: number;
}

/**
 * This message name collides with the runtime's typeofJsonValue import
 */
export interface typeofJsonValue {
    value: string;
}
