/**
 * Tests that supplementary plane characters (above U+FFFF) in custom option
 * strings are escaped as surrogate pairs (\uD83C\uDF89) matching the TS
 * compiler, not as ES2015 \u{1F389} which the Go plugin produces.
 */
export interface TestMsg {
    name: string;
}
