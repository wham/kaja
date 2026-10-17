import type { Call, CallOptions, Input } from "kaja";

/**
 * Empty message (no fields)
 */
export interface EmptyMessage {}

/**
 * Message with only reserved fields
 */
export interface OnlyReserved {}

export interface Request {
    query: string;
}

export interface Response {
    result: string;
}

/**
 * Nested empty messages
 */
export interface Container {
    empty?: Container_Empty;
    value: string;
}

export interface Container_Empty {}

/**
 * Map with empty message value
 */
export interface MapWithEmpty {
    data: { [key: string]: EmptyMessage };
}

/**
 * Repeated empty messages
 */
export interface RepeatedEmpty {
    items: EmptyMessage[];
}

/**
 * Oneof with empty message
 */
export interface OneofWithEmpty {
    value: {
        oneofKind: "empty";
        empty: EmptyMessage;
    } | {
        oneofKind: "text";
        text: string;
    } | {
        oneofKind: undefined;
    };
}

/**
 * Service with empty messages
 */
export declare const EmptyService: {
    DoNothing(input: Input<EmptyMessage>, options?: CallOptions): Call<EmptyMessage>;
    SendEmpty(input: Input<Request>, options?: CallOptions): Call<EmptyMessage>;
    ReceiveEmpty(input: Input<EmptyMessage>, options?: CallOptions): Call<Response>;
};
