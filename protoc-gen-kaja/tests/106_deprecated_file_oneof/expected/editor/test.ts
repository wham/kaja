/**
 * @deprecated
 */
export interface MyMessage {
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
