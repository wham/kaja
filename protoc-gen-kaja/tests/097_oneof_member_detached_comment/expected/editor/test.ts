/**
 * A message with oneof member fields that have detached comments.
 */
export interface TestMessage {
    choice: {
        oneofKind: "text";
        /**
         * This is the leading comment for the string field.
         */
        text: string;
    } | {
        oneofKind: "number";
        /**
         * This is the leading comment for the int field.
         */
        number: number;
    } | {
        oneofKind: undefined;
    };
}
