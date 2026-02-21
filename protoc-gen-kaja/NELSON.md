## Task

You are a **senior adversarial tester**. A junior engineer is porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. Your job is to **find at least one new case where the Go output differs from the TypeScript original** and add a failing test that proves it.

You succeed when tests fail. You fail when tests pass.

## How This Works

You are running inside an automated loop. **Each invocation is stateless** — you have no memory of previous runs. This file (NELSON.md) is your only persistent memory. Read it first. Write to it before you finish. Your future self depends on it.

## Steps (follow this order every run)

1. **Read state.** Read the [Notes](#notes) section below. Understand what tricks have already been tried and what areas remain unexplored.
2. **Orient.** Study the Go implementation (`protoc-gen-kaja/main.go`) and the TS plugin source. Look for discrepancies: edge cases, missing features, incorrect escaping, wrong formatting, missing options handling.
3. **Find a gap.** Pick ONE specific behavior where the Go plugin likely differs from the TS plugin. Be creative — look at proto2 features, obscure options, unusual naming, deep nesting, corner cases in comments, whitespace, import ordering, etc.
4. **Write a failing test.** Create or modify a test case with a `.proto` file that exposes the bug. Spend the bulk of your effort here. The test must actually fail — run it and confirm.
5. **Test.** Run the full test suite. Verify your new test fails. If it passes (the Go plugin handles it correctly), try a different angle — don't give up.
6. **Update memory.** Update [Notes](#notes) with the trick you used, what worked, what didn't, and ideas for next time. Keep notes focused on **attack strategies**, not on tests you've already added. If a trick has been successfully used, note it briefly and move on to new ideas.
7. **Commit.** One-line past-tense commit message summarizing the new test.
8. **Check result.** If at least one test fails, write "HAHA" to protoc-gen-kaja/status.txt and stop. If all tests pass (you failed to break it), just end — you'll run again with a different approach.

## Rules

- **Your goal is failing tests.** A run where all tests pass is a failed run for you.
- **Never fix the Go implementation.** You write tests, not fixes.
- **Never weaken existing tests.** Don't modify passing tests to make them fail artificially.
- **Be creative and adversarial.** Think about proto2 vs proto3 differences, obscure field options, unicode in identifiers, deeply nested types, circular imports, reserved words in different contexts, whitespace sensitivity, comment edge cases, etc.
- **One new test per run.** Focus on one specific bug. Don't shotgun multiple test cases.
- **Don't repeat yourself.** If a trick is logged in Notes as already used, find a new one.
- **Keep Notes as an attack playbook.** Good: "Boolean map keys — Go returns 'boolean', TS returns 'string'. Tested in 300_bool_map_key." Bad: "Good progress finding bugs."

## Notes

### Successfully exploited
- **WKT-typed custom field options** — When a custom field option uses a Well-Known Type (e.g. `google.protobuf.Duration`, `google.protobuf.Timestamp`) as its message type, the Go plugin drops the option entirely. Root cause: `findMessageType` only searched direct dependencies, not all files. Fixed by RALPH. Tested in `239_wkt_custom_option`.
- **Hyphenated json_name in custom option messages** — When a message used as a custom option value has fields with `json_name` containing non-identifier characters (hyphens, spaces, etc.), the Go plugin emits the key unquoted (`my-value: ...`) while TS quotes it (`"my-value": ...`). Root cause: `formatCustomOptions` only quotes keys containing `.` or starting with a digit, but doesn't check for other special chars. The TS `typescriptLiteralFromValue` uses regex `/^(?![0-9])[a-zA-Z0-9$_]+$/` to decide quoting. Tested in `240_custom_option_hyphen_json_name`.
- **Control characters in custom option strings** — The Go plugin's `formatCustomOptions` only escapes `\`, `"`, `\n`, `\r`, `\t` in string values. But the TS plugin uses TypeScript's `createStringLiteral` + printer which also escapes `\v` (vertical tab, 0x0B), `\f` (form feed), `\b` (backspace), `\0` (null), and other control characters via `\uXXXX`. So a string like `"hello\vworld"` is emitted correctly by TS but the Go plugin emits the raw 0x0B byte. Root cause: incomplete string escaping in `formatCustomOptions`. Tested in `241_custom_option_string_vtab`.
- **Integer map key ordering in custom options** — When a custom option message has a `map<int32, string>` field, the TS plugin uses `type.toJson(type.fromBinary(...))` which creates a JavaScript object. JS engines sort integer-index keys (valid array indices 0..2^32-2) in ascending numeric order regardless of insertion order. So keys added as 10, 1 become `{"1": ..., "10": ...}`. The Go plugin preserves wire order, so the same entries stay as `{"10": ..., "1": ...}`. Root cause: `mergeRepeatedOptions` preserves wire order; needs to sort integer-like map keys numerically. Tested in `242_custom_map_int_key_order`.

- **Single-element repeated field in custom option** — When a custom option message has a `repeated string` field set with a single value, the TS plugin emits it as an array `["solo"]` (via `type.toJson()` which always wraps repeated fields in arrays). The Go plugin's `mergeRepeatedOptions` only creates arrays when there are MULTIPLE entries with the same key; a single entry is left unwrapped as `"solo"`. Root cause: Go doesn't distinguish between singular and repeated fields — it relies on merge count, not field cardinality. Tested in `243_custom_option_repeated_single`.

- **U+2028/U+2029 LINE/PARAGRAPH SEPARATOR in custom option strings** — TypeScript's printer escapes U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) as `\u2028` and `\u2029` because they are not valid unescaped in JS string literals (pre-ES2019). The Go plugin's `escapeStringForJS` only escapes characters < U+0020, so it emits the raw UTF-8 bytes for these characters. Same issue applies to U+0085 (NEXT LINE), U+00A0 (NO-BREAK SPACE), and U+FEFF (BOM). Root cause: `escapeStringForJS` doesn't escape non-ASCII characters that TypeScript's printer escapes. Tested in `244_custom_option_string_linesep`.

- **Single-element repeated top-level extension** — When a `repeated string` top-level extension (extending e.g. `MessageOptions`) has a single value, the TS plugin emits `["solo"]` (array) but the Go plugin emits `"solo"` (bare string). Root cause: `parseCustomOptions` calls `mergeRepeatedOptions` which only creates arrays on duplicate keys, but unlike `parseMessageValue`, it has NO post-merge wrapping logic to force single repeated values into arrays. The fix in `parseMessageValue` (lines 1066-1084) checks `fd.GetLabel() == LABEL_REPEATED` and wraps, but `parseCustomOptions` doesn't have access to the field label or doesn't apply the same check. Tested in `245_repeated_extension_single`.

- **String map key escaping in custom options** — When a `map<string, string>` custom option has keys containing special characters (backslash, double quotes), the Go plugin wraps the key in quotes via `needsQuoteAsPropertyKey` but does NOT escape the content. `formatCustomOptions` line 1177 does `fmt.Sprintf("\"%s\"", opt.key)` which inserts the raw string. So a key `back\slash` becomes `"back\slash"` (where `\s` is interpreted as an escape in JS) instead of `"back\\slash"`. Same issue with double quotes: key `has"quote` becomes `"has"quote"` (broken string literal) instead of `"has\"quote"`. Root cause: `formatCustomOptions` needs to call `escapeStringForJS` on map keys before quoting. Tested in `246_custom_map_string_key_escape`.

- **U+0085 NEXT LINE in custom option strings** — TypeScript's compiler `escapeString` regex explicitly includes `\u0085`: `/[\\\"\u0000-\u001f\t\v\f\b\r\n\u2028\u2029\u0085]/g`. The escape map has `"\u0085": "\\u0085"`. But Go's `escapeStringForJS` only checks `r < 0x20 || r == 0x2028 || r == 0x2029`, and U+0085 (0x85) is above 0x20, so it emits the raw UTF-8 bytes instead of `\u0085`. Root cause: missing U+0085 check in `escapeStringForJS`. Tested in `247_custom_option_string_nextline`.

- **Null byte followed by digit in custom option strings** — TypeScript's `getReplacement` function in `escapeString` has special handling: when `\0` (null byte) is followed by a digit character (0-9), it emits `\x00` instead of `\0` to avoid creating an octal escape sequence. For example, the byte sequence `\x00\x31` (null + '1') becomes `\x001` in TS but `\01` in Go. The Go plugin's `escapeStringForJS` always emits `\0` for null without checking the next character. Root cause: `escapeStringForJS` processes each rune independently without lookahead; needs context-sensitive escaping for null followed by digits. Tested in `248_custom_option_string_null_digit`.

### Areas thoroughly tested with NO difference found
- All 15 scalar types, maps, enums, oneofs, groups, nested messages, services (all streaming types)
- Custom options: scalar, enum, bool, bytes (base64), repeated, nested message, NaN/Infinity floats, negative int32
- Proto2: required fields, defaults (string escapes, NaN, inf, bytes hex/octal), extension ranges, groups in oneof
- Proto3: optional fields, proto3_optional
- Comments: unicode, empty, whitespace-only, trailing, detached
- Field names: JS keywords, digit edges, double underscores, SCREAMING_SNAKE, MixedCase, leading underscore
- json_name: custom, uppercase, with special chars
- WKTs as field types (not options): Any, Struct, Value, ListValue
- Property collisions: __proto__, toString, oneofKind
- Import ordering, cross-file types, no-package files
- Multiple custom extensions on same field (ordering)
- Service/method options (non-WKT types)

### Ideas for future runs
- Same repeated-extension-single bug likely applies to repeated enum, repeated int32, repeated bytes, repeated message top-level extensions with a single value — all go through `parseCustomOptions` which lacks wrapping.
- Same integer-key ordering issue applies to `map<uint32, string>`, `map<int64, string>`, `map<uint64, string>`, etc. — all numeric map key types would have JS Object.keys() reordering. But RALPH will likely fix all at once.
- Bool map keys in custom options: TS may order `false` before `true` (since `Object.keys` on `{true: ..., false: ...}` preserves insertion order for non-integer keys). Check if wire order `true, false` matches TS order.
- Other control chars in custom option strings: `\b` (backspace 0x08), `\f` (form feed 0x0C), `\0` (null 0x00) — same root cause as vtab, likely all broken
- Control chars in nested message field string values (same escaping code path in `parseMessageValue`)
- U+00A0 (NBSP) and U+FEFF (BOM) are NOT escaped by TS printer (verified: regex only has `\u0085`, not these). Don't test.
- U+0085 NEXT LINE — confirmed different. TS escapes it via regex `\u0085` in `doubleQuoteEscapedCharsRegExp`. Go misses it because 0x85 > 0x20. Fix: add `r == 0x0085` check in `escapeStringForJS`.
- Wrapper types (Int32Value, BoolValue, etc.) as custom option types — tested, NO difference (TS plugin uses generic MessageType not WKT-aware toJson for options)
- Custom options with `google.protobuf.Any`, `google.protobuf.Struct`, `google.protobuf.Value` as the option type
- Custom options with `google.protobuf.FieldMask`, `google.protobuf.Empty` as option types
- Custom oneof-level options (`OneofOptions` extensions)
- Extension field info generation for proto2 `extend` blocks
- Custom options where nested message field json_name contains other invalid JS identifier chars (e.g., spaces, `@`, `+`)
- Top-level extension key quoting for non-identifier characters (currently only dot and digit-start checked)
- Custom enum options (`EnumOptions` extensions) — tested, no difference (neither plugin emits them)
- Custom `EnumValueOptions` extensions — untested
- `toCamelCase` vs `lowerCamelCase` — thoroughly compared, no differences found for any common pattern
- Map ordering for string keys that look like integers — JS treats "0", "1", ..., "4294967294" as array indices, sorting them numerically. String map keys like these would also get reordered by TS but not Go.
- Null byte NOT followed by a digit should still use `\0` (not `\x00`). Test to confirm Go and TS match for null followed by a letter or other non-digit char.
- Same null-before-digit issue likely occurs in map key strings, nested message string values — same `escapeStringForJS` function used everywhere.
