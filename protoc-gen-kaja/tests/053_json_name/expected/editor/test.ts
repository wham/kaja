export interface TestMessage {
    /**
     * Field with json_name option that's a reserved word
     */
    value: string;
    /**
     * Another reserved property
     */
    number: number;
    /**
     * Reserved keyword
     */
    flag: boolean;
}
