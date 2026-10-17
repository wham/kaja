export interface Test {
    /**
     * Proto3 optional scalar - should get opt: true
     */
    optionalScalar?: number;
    /**
     * Proto3 optional enum - should get opt: true
     */
    optionalEnum?: Status;
    /**
     * Oneof with scalar - should NOT get opt: true (in oneof already)
     */
    choice: {
        oneofKind: "scalarChoice";
        scalarChoice: number;
    } | {
        oneofKind: "enumChoice";
        enumChoice: Status;
    } | {
        oneofKind: undefined;
    };
}

export enum Status {
    UNKNOWN = 0,
    ACTIVE = 1,
}
