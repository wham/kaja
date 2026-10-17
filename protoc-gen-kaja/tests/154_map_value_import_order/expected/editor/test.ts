import type { Value, Struct } from "./google/protobuf/struct";

/**
 * Map field referencing Value appears BEFORE a regular field referencing Struct.
 * Both types are from the same import file. The import order should follow
 * field order: Value first, then Struct.
 */
export interface Foo {
    values: { [key: string]: Value };
    data?: Struct;
}
