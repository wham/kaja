import type { Outer_Middle_Inner_Deep } from "./dep";

/**
 * Message referencing a 4-level deep nested type from another file
 */
export interface Wrapper {
    data?: Outer_Middle_Inner_Deep;
}
