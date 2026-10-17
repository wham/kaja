/**
 * Test map fields with various scalar value types
 * to exercise the map value writer for all scalar types.
 */
export interface MapScalarValues {
    doubleMap: { [key: string]: number };
    floatMap: { [key: string]: number };
    int64Map: { [key: string]: string };
    uint64Map: { [key: string]: string };
    sint32Map: { [key: string]: number };
    sint64Map: { [key: string]: string };
    fixed32Map: { [key: string]: number };
    fixed64Map: { [key: string]: string };
    sfixed32Map: { [key: string]: number };
    sfixed64Map: { [key: string]: string };
    bytesMap: { [key: string]: Uint8Array };
    uint32Map: { [key: string]: number };
}
