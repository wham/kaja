import type { Metadata as Metadata$ } from "../common/types";

/**
 * Message named WireType - collides with protobuf-ts runtime import
 */
export interface WireType {
    name: string;
    id: number;
}

/**
 * Message named MessageType - collides with protobuf-ts runtime import
 */
export interface MessageType {
    name: string;
    description: string;
}

/**
 * Same-name type as common.Metadata to test cross-package collision
 */
export interface Metadata {
    internalId: string;
    source: string;
}

/**
 * Container with nested messages referencing collision types
 */
export interface Container {
    wire?: WireType;
    msg?: MessageType;
    meta?: Metadata;
    commonMeta?: Metadata$;
    inner?: Container_Inner;
}

export interface Container_Inner {
    value: string;
    wireRef?: WireType;
}
