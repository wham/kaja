export interface MyMessage {
    /**
     * Choose one option.
     */
    choice: {
        oneofKind: "text";
        /**
         * The text value.
         */
        text: string;
    } | {
        oneofKind: "number";
        /**
         * The number value.
         */
        number: number;
    } | {
        oneofKind: undefined;
    };
}
