export interface TestMessage {
    Proto: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
    toString$: {
        oneofKind: "flag";
        flag: boolean;
    } | {
        oneofKind: "value";
        value: number;
    } | {
        oneofKind: undefined;
    };
}
