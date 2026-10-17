/**
 * Any triggers import of IMessageType from @protobuf-ts/runtime.
 * A local message named IMessageType should cause a collision that needs aliasing.
 */
export interface Any {
    typeUrl: string;
    value: Uint8Array;
}

export interface IMessageType {
    name: string;
    version: number;
}
