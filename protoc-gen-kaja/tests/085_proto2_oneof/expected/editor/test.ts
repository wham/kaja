/**
 * Proto2 message with oneof - oneof fields should NOT have "optional" label
 * in the @generated comment, even though proto2 marks them as LABEL_OPTIONAL
 * in the descriptor.
 */
export interface Proto2WithOneof {
    id: string;
    name?: string;
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
}
