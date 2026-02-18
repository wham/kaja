## Task

You are porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. The Go implementation must produce **byte-for-byte identical output** to the TypeScript original. No exceptions. No "close enough".

## How This Works

You are running inside an automated loop. **Each invocation is stateless** — you have no memory of previous runs. This file (RALPH.md) is your only persistent memory. Read it first. Write to it before you finish. Your future self depends on it.

## Steps (follow this order every run)

1. **Read state.** Read the [Plan](#plan) and [Notes](#notes) sections below. Understand where you left off. Don't redo work that's already done.
2. **Orient.** If Plan is empty, analyze the codebase, research the TS plugin (clone it if needed), and write a detailed plan. If Plan exists, pick the next incomplete item.
3. **Implement.** Spend the bulk of your effort here. Work on ONE failing test case or feature at a time. Make real, substantive progress.
4. **Test.** Run the tests. Read the output carefully. If a test fails, understand WHY before changing code.
5. **Update memory.** Update [Plan](#plan) with what's done and what's next. Update [Notes](#notes) with learnings that will help future runs. Be specific — file paths, function names, gotchas, how to run tests.
6. **Commit.** One-line past-tense message summarizing what changed.
7. **Check completion.** If ALL tests pass, write "DONE" to /status.txt and stop. If any test fails, do NOT write DONE. Just end — you'll run again.

## Rules

- **DONE means ALL tests pass.** Not most. Not "the important ones". ALL. Zero failures.
- **Never weaken requirements.** Don't modify test expectations. Don't skip tests. Don't add notes like "close enough" or "cosmetic difference". If you see such notes below, delete them.
- **Never mark DONE prematurely.** Run the full test suite and confirm zero failures before writing DONE.
- **Be bold with architecture.** If the current approach is fundamentally wrong, refactor it. Document why in the plan.
- **Keep Notes actionable.** Good: "Run tests with `protoc-gen-kaja/scripts/test`. Failures show as diffs." Bad: "Making good progress overall."
- **One thing at a time.** Fix one test, commit, move to the next. Don't try to fix everything in one run.

## Plan

- [x] Fix test 79_only_imports: Skip WKT generation when no FileToGenerate produced output
- [x] Verify test 61_imported_method_options still passes (transitive WKT deps)
- [x] All 85/85 tests passing
- [x] Fix test 82_map_scalar_value_types: getMapValueWriter now delegates to getWireType+getWriterMethodName instead of hardcoding only 4 types
- [x] All 86/86 tests passing
- [x] Fix test 83_map_fixed_key_types: Simplified getMapKeyWriter to reuse getWireType+getWriterMethodName
- [x] Fix test 84_map_message_value_fixed_keys: Message-value map write path now uses getMapKeyWriter for proper wire types/methods instead of hardcoding Varint/int32
- [x] All 88/88 tests passing
- [x] Fix test 85_proto2_required_message: Required message fields in proto2 should still generate optional TS properties (`?:`)
- [x] Fix test 86_proto2_oneof: Proto2 oneof member fields should not show `optional` label in comments
- [x] All 90/90 tests passing
- [x] Fix test 87_oneof_json_name: Added json_name annotation to oneof field comments and jsonName property to scalar oneof field info entries
- [x] All 91/91 tests passing
- [x] Fix test 88_oneof_deprecated: Added @deprecated JSDoc tag and [deprecated = true] annotation for deprecated oneof member fields
- [x] All 92/92 tests passing
- [x] Fix test 89_oneof_jstype: Added jstype annotation (`[jstype = JS_NUMBER]`/`[jstype = JS_STRING]`) to oneof member field `@generated` comments
- [x] All 93/93 tests passing
- [x] Fix test 90_map_underscore_message: Used `protoName` instead of `strings.ReplaceAll(fullName, "_", ".")` for map error messages, since message names can contain underscores
- [x] Fix test 91_nested_oneof_comment: Pass msg descriptor and full msgPath to generateOneofField instead of just msgIndex, so nested message oneofs use correct source locations
- [x] Fix test 92_proto2_oneof_default: Added default value annotation (`[default = ...]`) to oneof member field `@generated` interface comments
- [x] All 96/96 tests passing
- [x] Fix test 93_oneof_trailing_blank_comment: Added __HAS_TRAILING_BLANK__ marker handling to oneof and oneof-field comment generation, matching the pattern used elsewhere
- [x] Fix test 94_enum_value_trailing_blank_comment: Added enum trailing comments support and __HAS_TRAILING_BLANK__ handling for enum value leading comments
- [x] All 98/98 tests passing
- [x] Fix test 95_proto2_oneof_enum: Proto2 oneof enum members should not get `opt: true` — added `field.OneofIndex == nil` check
- [x] All 99/99 tests passing — DONE

## Notes

- Run tests with `protoc-gen-kaja/scripts/test --summary`. Full output without `--summary`.
- Use `protoc-gen-kaja/scripts/diff <test_name>` to inspect specific failures.
- Results are in `protoc-gen-kaja/results/<test_name>/`. Each has `expected/`, `actual/`, `result.txt`, and optionally `failure.txt`.
- The WKT generation logic (main.go ~line 209) must check `len(generatedFiles) > 0` before generating WKTs, but check ALL FileToGenerate (not just those with output) for dependency relationships. This handles both: (a) import-only files producing no output (test 79), and (b) transitive WKT deps through non-output files like `options.proto` (test 61).
- The `getMapValueWriter` function was simplified to reuse `getWireType` and `getWriterMethodName` instead of an incomplete switch statement. The old version only handled 4 types (int32, string, bool, enum) and fell back to string for everything else.
- The `getMapKeyWriter` function had the same problem — it grouped fixed types with their non-fixed counterparts (e.g. SFIXED32 with INT32), using WireType.Varint instead of WireType.Bit32. Simplified it the same way to delegate to getWireType+getWriterMethodName.
- The message-value map write path (line ~3456) had its own hardcoded key writer (Varint/int32 for all numeric keys) instead of reusing `getMapKeyWriter`. Fixed to use the same keyVar/valueAccessor logic as the scalar path, plus `getMapKeyWriter` for proper wire types.
- Proto2 `required` message fields must still generate optional TS interface properties (`?:`) because messages have no zero value. The fix adds a check: when `LABEL_REQUIRED` and `TYPE_MESSAGE`, set `optional = "?"`.
- Proto2 oneof member fields have `LABEL_OPTIONAL` but should NOT show `optional` in generated comments. The fix checks `field.OneofIndex == nil` before adding the `optional` prefix in `getProtoType`.
- Oneof scalar fields with custom `json_name` need it in two places: (1) the interface field comment `[json_name = "..."]` and (2) the field info entry `jsonName: "..."` inserted between `localName` and `oneof` properties. The `internalBinaryRead`/`Write` comment paths already handled it.
- Deprecated oneof member fields need `@deprecated` JSDoc tag and `[deprecated = true]` in the `@generated` comment, same pattern as regular fields. The oneof interface generation (around line 2229) was missing this; added `fieldIsDeprecated` check and `oneofDeprecatedAnnotation` string.
- For nested messages, `generateOneofField` must receive the actual message descriptor and full `msgPath` (e.g. `[4, 0, 3, 0]`), not just the last element of `msgPath`. Using `g.file.MessageType[msgIndex]` only works for top-level messages. The field path must be built as `msgPath + [2, fieldIndex]` and the oneof path as `msgPath + [8, oneofIndex]`.
- The map binary read error string (`"unknown map entry field for ..."`) was using `strings.ReplaceAll(fullName, "_", ".")` to convert the TS name back to proto name. This breaks when message names themselves contain underscores (e.g., `My_Container`). Fixed to use `protoName` parameter directly, which already has the correct dot-separated nesting.
- Oneof member fields with default values need `[default = ...]` in their `@generated from protobuf field:` interface comments. The oneof comment generation was missing the `defaultAnnotation` that regular field comments already had. Added `oneofDefaultAnnotation` using the same `formatDefaultValueAnnotation` helper.
- The `__HAS_TRAILING_BLANK__` marker must be handled in ALL comment generation paths. Oneof comments (~line 2177) and oneof field comments (~line 2222) were missing this handling, causing the marker to appear literally in output. The pattern is: strip the marker, then emit two `*` lines instead of one before the `@generated` tag.
- Enum trailing comments (TrailingComments on the enum path, e.g. `[5,0]`) need to be included in the enum's JSDoc comment. Added `getEnumTrailingComments` method that preserves trailing blank info (unlike regular `getTrailingComments` which strips it). Enum value leading comments also need `__HAS_TRAILING_BLANK__` handling.