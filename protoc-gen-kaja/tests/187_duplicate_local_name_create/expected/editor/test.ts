/**
 * Two fields whose names produce the same lowerCamelCase localName.
 * "x123y" → "x123Y", "x_1_2_3_y" → "x123Y".
 * The create() method should use the LAST field's default (last-write-wins
 * from Object.entries on the runtime create result).
 */
export interface Foo {
    x123Y: string;
    x123Y: number;
}
