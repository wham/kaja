export interface Result {
    outcome: {
        oneofKind: "value";
        /**
         * The success
         * value returned
         */
        value: string;
    } | {
        oneofKind: "error";
        error: string;
    } | {
        oneofKind: undefined;
    };
}
