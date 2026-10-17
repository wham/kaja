/**
 * Test non-sequential field numbers
 */
export interface FieldNumberGaps {
    field1: string;
    field100: string;
    field50: string;
    field2: string;
    field1000: string;
    field500: string;
}

/**
 * Test field numbers starting high
 */
export interface HighFieldNumbers {
    /**
     * Max field number
     */
    field536870911: string;
    field1000: string;
    field10000: string;
}

/**
 * Test sparse field numbers
 */
export interface SparseFields {
    a: string;
    b: string;
    c: string;
    d: string;
    e: string;
    f: string;
    g: string;
    h: string;
    i: string;
    j: string;
}

/**
 * Test reversed order field numbers (in proto definition)
 */
export interface ReversedOrder {
    last: string;
    middle: string;
    first: string;
    another: string;
    yetAnother: string;
}

/**
 * Test oneof with gaps
 */
export interface OneofWithGaps {
    id: string;
    value: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: "flag";
        flag: boolean;
    } | {
        oneofKind: undefined;
    };
    name: string;
}

/**
 * Test map with high field number
 */
export interface MapWithHighNumber {
    id: string;
    data: { [key: string]: string };
}
