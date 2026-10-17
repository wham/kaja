export interface Result {
    outcome: {
        oneofKind: "value";
        /**
         * The success value
         */
        value: string;
    } | {
        oneofKind: "error";
        /**
         * The error message
         */
        error: string;
    } | {
        oneofKind: undefined;
    };
}
