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
- [x] All 99/99 tests passing
- [x] Fix test 96_service_trailing_blank_comment: Service and method comments in client file need `hasTrailingBlank` conditional (two `*` lines instead of one)
- [x] All 100/100 tests passing
- [x] Fix test 97_oneof_detached_comment: Added leading detached comments support for oneof declarations, same pattern as regular fields
- [x] Fix test 98_oneof_member_detached_comment: Oneof trailing comment (from `oneof` declaration path) goes into the oneof JSDoc; non-first member field detached comments go as `//` before the field JSDoc
- [x] All 102/102 tests passing
- [x] Fix test 99_service_first_method_detached: Removed `methodIdx > 0` guard on detached comment output for service methods — first method's detached comments were being skipped
- [x] All 103/103 tests passing
- [x] Fix test 100_oneof_kind_field_escape: Added `oneofKind` to the list of reserved property names that get `$` suffix escaping (alongside `__proto__` and `toString`), matching protobuf-ts's `oneofKindDiscriminator` collision handling
- [x] Fix test 101_service_detached_comment: Added service-level LeadingDetachedComments as `//` line comments before JSDoc blocks for both the interface and implementation class in generateServiceClient
- [x] Fix test 102_oneof_name_escape: Added `oneofKind` to the oneof name escaping check (alongside `__proto__` and `toString`) in all 5 locations where oneofCamelName is computed
- [x] Fix test 103_field_detached_comment_blank: Detached comment blank lines within a block should use `// ` (with trailing space), and separators between blocks should be empty lines (not `//`). Fixed in 6 locations: field, oneof, oneof member, and service (interface + implementation).
- [x] Fix test 104_service_method_detached_blocks: Added empty line separators between multiple detached comment blocks for service methods (both interface and implementation), matching the pattern used by field detached comments
- [x] Fix test 105_file_detached_comment_blank: File-level detached comments (first message) need `// ` (with trailing space) for blank lines within blocks and empty lines between blocks, same pattern as field/service detached comments. Note: the file-header license comment section (syntax path 12) uses `//` (no trailing space) — do NOT change those.
- [x] All 109/109 tests passing — DONE

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
- Service and method comments in `generateServiceClient` (client file) had 4 locations that unconditionally output one ` *` after comment lines but need two when `hasTrailingBlank` is true. Same pattern as everywhere else.
- Oneof declarations need detached comment handling (LeadingDetachedComments on the oneof path `[4, msgIdx, 8, oneofIdx]`). These are output as `// ...` lines before the oneof's JSDoc `/**` block, same pattern as field detached comments.
- The first oneof member field's "detached comment" is actually a **trailing comment** on the oneof declaration itself (path `[4, msgIdx, 8, oneofIdx]`), not a LeadingDetachedComment on the field. It goes into the oneof JSDoc block before `@generated from protobuf oneof:`. Non-first member field detached comments are proper LeadingDetachedComments on the field path and go as `//` style before the field's JSDoc.
- Service method detached comments should be output for ALL methods including the first one (methodIdx == 0). The `methodIdx > 0` guard was wrong — it skipped the first method's detached comments in both the interface and implementation sections of `generateServiceClient`.
- Field names whose camelCase form equals `oneofKind` must be escaped with `$` suffix (e.g. `oneofKind$`). This is because `oneofKind` is the discriminator property used by protobuf-ts for oneof unions. The TS plugin checks against `oneofKindDiscriminator` option (default `"oneofKind"`). The escaping must also trigger `localName` in the field info descriptor.
- Service-level detached comments (LeadingDetachedComments on path `[6, svcIndex]`) must be output as `//` line comments before the `/**` JSDoc block for both the interface and the class in `generateServiceClient`. Same pattern as oneof detached comments but using `g.pNoIndent()` since service comments are at top level (no indent).
- Oneof names whose camelCase form equals `oneofKind` must also be escaped with `$` suffix. There are 5 separate locations where `oneofCamelName` is computed and needs the escape check: interface generation (~line 1943), field descriptor generation (~line 2885), create() method (~line 3225), internalBinaryRead (~line 3346), and internalBinaryWrite (~line 3569). All must check `__proto__`, `toString`, AND `oneofKind`.
- Service method detached comments with multiple blocks need empty line separators between blocks (`if idx < len(detachedComments)-1 { g.pNoIndent("") }`), plus blank-line-within-block handling (`// ` with trailing space) and a final blank line after all blocks before the JSDoc. Same pattern as field detached comments. Both the interface and implementation sections of `generateServiceClient` need this fix.
- File-level detached comments on the first message (path `[4, 0]`) use `// ` (trailing space) for blank lines and empty lines between blocks. IMPORTANT: the file-header license comment section (syntax path `[12]`) uses `//` (no trailing space) — these are two different code paths and must NOT be confused.