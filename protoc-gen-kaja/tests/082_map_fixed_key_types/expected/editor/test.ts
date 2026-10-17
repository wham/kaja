/**
 * Test map fields with fixed-width integer key types.
 * These use Bit32/Bit64 wire types and fixed32/fixed64/sfixed32/sfixed64 writer methods,
 * NOT Varint wire type with int32/uint32/int64/uint64 methods.
 */
export interface FixedKeyMaps {
    fixed32Key: { [key: number]: string };
    fixed64Key: { [key: string]: string };
    sfixed32Key: { [key: number]: string };
    sfixed64Key: { [key: string]: string };
}
