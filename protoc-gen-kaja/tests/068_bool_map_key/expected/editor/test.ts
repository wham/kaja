export interface BoolMapTest {
    /**
     * Map with boolean key - in TypeScript, boolean object keys become strings
     * So the interface should use { [key: string]: string } not { [key: boolean]: string }
     */
    boolToString: { [key: string]: string };
    boolToInt: { [key: string]: number };
    boolToMessage: { [key: string]: SubMessage };
}

export interface SubMessage {
    value: string;
}
