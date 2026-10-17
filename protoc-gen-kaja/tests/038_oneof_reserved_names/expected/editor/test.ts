export interface TestMessage {
    value: {
        oneofKind: "constructor";
        constructor: string;
    } | {
        oneofKind: "toString$";
        toString$: number;
    } | {
        oneofKind: "name";
        name: boolean;
    } | {
        oneofKind: undefined;
    };
}
