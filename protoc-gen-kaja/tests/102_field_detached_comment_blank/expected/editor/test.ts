/**
 * Tests that field-level detached comments with blank lines
 * use the correct formatting:
 * - blank line within a detached block should be "// " (with trailing space)
 * - separator between detached blocks should be an empty line (not "//")
 */
export interface MyMessage {
    /**
     * Name of the entity.
     */
    name: string;
    /**
     * Regular field.
     */
    age: number;
}
