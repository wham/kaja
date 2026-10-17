export interface Test {
    /**
     * Leading comment for the oneof group
     * Multiple lines here
     */
    choice: {
        oneofKind: "optionA";
        /**
         * Field comment
         */
        optionA: string;
    } | {
        oneofKind: "optionB";
        optionB: number;
    } | {
        oneofKind: undefined;
    };
    /**
     * Trailing comment stays outside
     */
    other: string;
}
