/**
 * A message that collides with the runtime import type BinaryReadOptions.
 */
export interface BinaryReadOptions {
    name: string;
    level: number;
}

export interface Container {
    opts?: BinaryReadOptions;
}
