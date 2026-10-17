export interface TestMessage {
    /**
     * Oneof with reserved name toString
     */
    toString$: {
        oneofKind: "toStringValue";
        toStringValue: string;
    } | {
        oneofKind: "toStringNumber";
        toStringNumber: number;
    } | {
        oneofKind: undefined;
    };
    /**
     * Oneof with reserved name constructor
     */
    constructor: {
        oneofKind: "constructorValue";
        constructorValue: string;
    } | {
        oneofKind: undefined;
    };
}
