/**
 * Tests that non-ASCII characters in custom option string values
 * are escaped as \uXXXX (matching TypeScript printer's escapeNonAsciiString).
 */
export interface TestMsg {
    name: string;
}
