/**
 * Test message with multiple oneof groups
 */
export interface MultipleOneofs {
    id: string;
    authentication: {
        oneofKind: "password";
        password: string;
    } | {
        oneofKind: "token";
        token: string;
    } | {
        oneofKind: "apiKey";
        apiKey: string;
    } | {
        oneofKind: undefined;
    };
    dataFormat: {
        oneofKind: "json";
        json: string;
    } | {
        oneofKind: "xml";
        xml: string;
    } | {
        oneofKind: "binary";
        binary: Uint8Array;
    } | {
        oneofKind: undefined;
    };
    status: {
        oneofKind: "active";
        active: boolean;
    } | {
        oneofKind: "inactive";
        inactive: boolean;
    } | {
        oneofKind: "pending";
        pending: boolean;
    } | {
        oneofKind: undefined;
    };
    name: string;
    metadata: {
        oneofKind: "description";
        description: string;
    } | {
        oneofKind: "version";
        version: number;
    } | {
        oneofKind: undefined;
    };
}

/**
 * Test nested message with oneof
 */
export interface Container {
    id: string;
    nested?: Container_Nested;
    containerType: {
        oneofKind: "label";
        label: string;
    } | {
        oneofKind: "count";
        count: number;
    } | {
        oneofKind: undefined;
    };
}

export interface Container_Nested {
    value: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
}

/**
 * Test oneof with all scalar types
 */
export interface OneofAllTypes {
    value: {
        oneofKind: "doubleVal";
        doubleVal: number;
    } | {
        oneofKind: "floatVal";
        floatVal: number;
    } | {
        oneofKind: "int32Val";
        int32Val: number;
    } | {
        oneofKind: "int64Val";
        int64Val: string;
    } | {
        oneofKind: "uint32Val";
        uint32Val: number;
    } | {
        oneofKind: "uint64Val";
        uint64Val: string;
    } | {
        oneofKind: "sint32Val";
        sint32Val: number;
    } | {
        oneofKind: "sint64Val";
        sint64Val: string;
    } | {
        oneofKind: "fixed32Val";
        fixed32Val: number;
    } | {
        oneofKind: "fixed64Val";
        fixed64Val: string;
    } | {
        oneofKind: "sfixed32Val";
        sfixed32Val: number;
    } | {
        oneofKind: "sfixed64Val";
        sfixed64Val: string;
    } | {
        oneofKind: "boolVal";
        boolVal: boolean;
    } | {
        oneofKind: "stringVal";
        stringVal: string;
    } | {
        oneofKind: "bytesVal";
        bytesVal: Uint8Array;
    } | {
        oneofKind: undefined;
    };
}
