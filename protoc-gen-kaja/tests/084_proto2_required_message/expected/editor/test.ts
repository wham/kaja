export interface Inner {
    value?: string;
}

/**
 * Required message fields should still be optional in TypeScript
 */
export interface Outer {
    requiredInner?: Inner;
    requiredString: string;
    optionalInner?: Inner;
}
