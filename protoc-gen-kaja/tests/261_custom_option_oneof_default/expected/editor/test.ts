export interface ChoiceOption {
    choice: {
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

export interface Foo {
    /**
     * Non-default oneof value (control case — both plugins should include it)
     */
    alpha: string;
    /**
     * Oneof string set to empty string (default for string)
     */
    beta: string;
    /**
     * Oneof int32 set to 0 (default for int32)
     */
    gamma: string;
    /**
     * Oneof bool set to false (default for bool)
     */
    delta: string;
}
