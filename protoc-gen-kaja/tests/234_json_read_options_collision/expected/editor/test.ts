/**
 * Timestamp triggers import of JsonReadOptions from @protobuf-ts/runtime.
 * A local message named JsonReadOptions should cause a collision that needs aliasing.
 */
export interface Timestamp {
    seconds: string;
    nanos: number;
}

export interface JsonReadOptions {
    name: string;
}
