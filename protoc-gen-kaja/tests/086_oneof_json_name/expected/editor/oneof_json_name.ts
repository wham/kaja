/**
 * Test that custom json_name on oneof scalar fields is preserved in reflection metadata
 */
export interface OneofWithJsonName {
    choice: {
        oneofKind: "firstOption";
        firstOption: string;
    } | {
        oneofKind: "secondOption";
        secondOption: number;
    } | {
        oneofKind: "thirdOption";
        thirdOption: boolean;
    } | {
        oneofKind: undefined;
    };
}
