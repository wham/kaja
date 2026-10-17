export interface Payload {
    text: string;
}

export interface Event {
    id: string;
    body: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: "flag";
        flag: boolean;
    } | {
        oneofKind: "payload";
        payload: Payload;
    } | {
        oneofKind: undefined;
    };
}
