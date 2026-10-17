/**
 * Tests that U+FEFF (BOM) in a custom option string is escaped with
 * UPPERCASE hex digits. The TS compiler emits \uFEFF but the Go plugin
 * emits \ufeff because it uses fmt %04x (lowercase) instead of %04X.
 */
export interface TestMsg {
    name: string;
}
