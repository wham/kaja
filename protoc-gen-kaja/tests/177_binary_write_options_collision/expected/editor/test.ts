/**
 * A message that collides with the runtime import type BinaryWriteOptions.
 */
export interface BinaryWriteOptions {
    name: string;
    level: number;
}

export interface Container {
    opts?: BinaryWriteOptions;
}
