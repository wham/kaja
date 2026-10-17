/**
 * Proto2 oneof with enum field should NOT get "opt: true" in field descriptor.
 * Oneof members are never optional — they use the oneof discriminator.
 */
export interface MyMessage {
    id: string;
    value: {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: "number";
        number: number;
    } | {
        oneofKind: "color";
        color: Color;
    } | {
        oneofKind: undefined;
    };
}

export enum Color {
    RED = 0,
    GREEN = 1,
    BLUE = 2,
}
