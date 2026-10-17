/**
 * Message with a field named oneof_kind which collides with the
 * oneofKindDiscriminator used by protobuf-ts for oneof unions.
 */
export interface MyMessage {
    oneofKind$: string;
    other: number;
}
