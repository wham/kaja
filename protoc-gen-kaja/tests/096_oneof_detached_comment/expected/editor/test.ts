export interface TestMessage {
    name: string;
    /**
     * This is the oneof leading comment
     */
    choice: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
}
