/**
 * Test map fields with message values and fixed-width integer key types.
 * The writer must use correct wire types and methods for keys even when
 * the value is a message type (not just scalars).
 */
export interface Inner {
    name: string;
}

export interface FixedKeyMessageMaps {
    fixed32Key: { [key: number]: Inner };
    fixed64Key: { [key: string]: Inner };
    sfixed32Key: { [key: number]: Inner };
    sfixed64Key: { [key: string]: Inner };
}
