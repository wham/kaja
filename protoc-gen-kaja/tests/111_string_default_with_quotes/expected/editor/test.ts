/**
 * Test that string default values containing escaped double quotes
 * are properly escaped in the @generated annotation.
 * The TS plugin escapes the first \" in the default value,
 * while the Go plugin may handle it differently.
 */
export interface StringDefaults {
    withQuote?: string;
    simple?: string;
}
