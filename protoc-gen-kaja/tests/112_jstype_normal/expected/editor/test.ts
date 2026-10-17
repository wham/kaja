/**
 * Test that [jstype = JS_NORMAL] option is handled correctly.
 * JS_NORMAL means "use the normal representation" which for int64/uint64
 * with long_type_string should produce bigint type and L: 0 /*LongType.BIGINT*\/
 * in the field descriptor.
 */
export interface JsTypeNormalTest {
    /**
     * Explicit JS_NORMAL - should output [jstype = JS_NORMAL] annotation
     * and L: 0 /*LongType.BIGINT*\/ in field descriptor
     */
    normalInt64: bigint;
    /**
     * Regular field without jstype for comparison
     */
    regularInt64: string;
    /**
     * JS_NORMAL on uint64 too
     */
    normalUint64: bigint;
}
