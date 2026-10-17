/**
 * Test that proto2 packed option is respected
 */
export interface PackedTest {
    /**
     * In proto2, repeated numeric fields are unpacked by default
     */
    defaultUnpacked: number[];
    /**
     * Explicitly packed in proto2
     */
    explicitlyPacked: number[];
    /**
     * Explicitly unpacked (even though it's the default)
     */
    explicitlyUnpacked: number[];
    /**
     * Various types with explicit packing
     */
    packedInt64: string[];
    packedBool: boolean[];
    packedFixed: number[];
    /**
     * Unpacked versions
     */
    unpackedInt64: string[];
    unpackedBool: boolean[];
    unpackedFixed: number[];
}
