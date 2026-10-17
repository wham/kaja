/**
 * Test jstype annotation on oneof fields with int64/uint64 types
 */
export interface OneofJsType {
    value: {
        oneofKind: "numberVal";
        /**
         * int64 field with jstype = JS_NUMBER in oneof
         */
        numberVal: number;
    } | {
        oneofKind: "stringVal";
        /**
         * string field in same oneof for comparison
         */
        stringVal: string;
    } | {
        oneofKind: "bigVal";
        /**
         * uint64 with jstype = JS_STRING in oneof
         */
        bigVal: string;
    } | {
        oneofKind: undefined;
    };
}
