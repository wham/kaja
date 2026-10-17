/**
 * Struct triggers import of JsonObject type from @protobuf-ts/runtime.
 * A local message named JsonObject should cause a collision that needs aliasing.
 */
export interface Struct {
    fields: { [key: string]: Value };
}

export interface Value {
    kind: {
        oneofKind: "nullValue";
        nullValue: NullValue;
    } | {
        oneofKind: "numberValue";
        numberValue: number;
    } | {
        oneofKind: "stringValue";
        stringValue: string;
    } | {
        oneofKind: "boolValue";
        boolValue: boolean;
    } | {
        oneofKind: "structValue";
        structValue: Struct;
    } | {
        oneofKind: "listValue";
        listValue: ListValue;
    } | {
        oneofKind: undefined;
    };
}

export interface ListValue {
    values: Value[];
}

export interface JsonObject {
    key: string;
    value: string;
}

export enum NullValue {
    NULL_VALUE = 0,
}
