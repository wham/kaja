export interface MyMessage {
    choice: {
        oneofKind: "activeName";
        activeName: string;
    } | {
        oneofKind: "oldName";
        /**
         * @deprecated
         */
        oldName: string;
    } | {
        oneofKind: "oldId";
        /**
         * @deprecated
         */
        oldId: number;
    } | {
        oneofKind: undefined;
    };
}
