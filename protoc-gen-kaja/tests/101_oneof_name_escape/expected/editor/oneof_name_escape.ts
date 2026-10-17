/**
 * Message with a oneof named oneof_kind which collides with the
 * oneofKindDiscriminator used by protobuf-ts for oneof unions.
 */
export interface MyMessage {
    oneofKind$: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: undefined;
    };
    other: string;
}
