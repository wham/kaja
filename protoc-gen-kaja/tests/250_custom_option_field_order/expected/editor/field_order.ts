/**
 * Message with fields declared in REVERSE field-number order.
 * protoc serializes by field number (alpha=1 first, beta=2 second),
 * but the TS plugin emits JSON keys in declaration order (beta first, alpha second).
 */
export interface StyleOption {
    beta: string;
    alpha: string;
}

export interface StyledMessage {
    value: string;
}
