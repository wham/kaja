/**
 * Test that [jstype = JS_STRING] option overrides global long_type setting
 */
export interface JsTypeTest {
    /**
     * Regular int64 field - should use global long_type (string by default)
     */
    regularInt64: string;
    /**
     * Explicitly set to JS_STRING - should always be string
     */
    stringInt64: string;
    /**
     * Explicitly set to JS_NUMBER - should be number
     */
    numberInt64: number;
    /**
     * Same for uint64
     */
    regularUint64: string;
    stringUint64: string;
    numberUint64: number;
    /**
     * Map with int64 key that has jstype option
     */
    mapWithRegularKey: { [key: string]: string };
}

/**
 * Test with fixed64 types too
 */
export interface FixedJsType {
    regularFixed64: string;
    stringFixed64: string;
    numberFixed64: number;
    regularSfixed64: string;
    stringSfixed64: string;
    numberSfixed64: number;
}
