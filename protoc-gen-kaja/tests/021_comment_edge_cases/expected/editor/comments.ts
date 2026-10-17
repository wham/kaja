/**
 * *
 * Multi-line comment with stars
 * Second line
 * Third line
 */
export interface MultiLineComment {
    value: string;
}

/**
 * Single line comment
 */
export interface SingleLineComment {
    value: string;
}

export interface FieldComments {
    /**
     * Leading comment for field1
     */
    field1: string;
    /**
     * Trailing comment for field2
     */
    field2: string;
    /**
     * *
     * JSDoc style comment
     * @param {string} value - The value
     * @returns {boolean} Success
     */
    field3: string;
    /**
     * Comment with special characters: @#$%^&*()
     */
    field4: string;
    /**
     * Comment with "quotes" and 'apostrophes'
     */
    field5: string;
    /**
     * Comment with backslashes \ and forward slashes /
     */
    field6: string;
    /**
     * C-style comment
     */
    field7: string;
    /**
     * Multi-line C-style
     * with asterisks
     */
    field8: string;
    /**
     * TODO: implement this field
     */
    field9: string;
    /**
     * FIXME: this needs review
     */
    field10: string;
    /**
     * Comment with code: `someCode()`
     */
    field11: string;
    /**
     * Comment with markdown **bold** and *italic*
     */
    field12: string;
    /**
     * Comment with emoji 🚀 ✨ 🎉
     */
    field13: string;
    /**
     * Comment with URL: https://example.com
     */
    field14: string;
    /**
     * Comment with XML: <tag>content</tag>
     */
    field15: string;
    field16: string;
}

export interface NestedComments {
    /**
     * Field using nested type
     */
    inner?: NestedComments_Inner;
}

/**
 * Outer comment
 */
export interface NestedComments_Inner {
    /**
     * Inner field comment
     */
    value: string;
}

/**
 * Enum with comments
 */
export enum CommentedEnum {
    /**
     * Unknown value
     */
    UNKNOWN = 0,
    /**
     * First value
     *
     * Trailing
     */
    VALUE1 = 1,
    /**
     * *
     * Second value
     * with multi-line comment
     */
    VALUE2 = 2,
}
