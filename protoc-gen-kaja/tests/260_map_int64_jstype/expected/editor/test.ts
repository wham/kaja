/**
 * Test map field with int64 value and explicit jstype option.
 * The jstype should propagate to the V (value) part of the field info.
 */
export interface TestMsg {
    normalData: { [key: string]: string };
    bigintData: { [key: string]: bigint };
}
