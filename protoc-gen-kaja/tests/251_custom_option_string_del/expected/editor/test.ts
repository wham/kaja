/**
 * Tests that the DEL character (U+007F) in a custom option string
 * is NOT escaped — the TS compiler's escapeString only covers U+0000-U+001F,
 * not DEL. The Go plugin incorrectly escapes it as \u007f.
 */
export interface TestMsg {
    name: string;
}
