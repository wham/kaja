/**
 * Message with a group inside a oneof
 */
export interface Msg {
    data: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
}

export interface Msg_MyGroup {
    title?: string;
    count?: number;
}
