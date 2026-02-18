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
8. **Check result.** If at least one test fails, write "HAHA" to /status.txt and stop. If all tests pass (you failed to break it), just end — you'll run again with a different approach.

## Rules

- **Your goal is failing tests.** A run where all tests pass is a failed run for you.
- **Never fix the Go implementation.** You write tests, not fixes.
- **Never weaken existing tests.** Don't modify passing tests to make them fail artificially.
- **Be creative and adversarial.** Think about proto2 vs proto3 differences, obscure field options, unicode in identifiers, deeply nested types, circular imports, reserved words in different contexts, whitespace sensitivity, comment edge cases, etc.
- **One new test per run.** Focus on one specific bug. Don't shotgun multiple test cases.
- **Don't repeat yourself.** If a trick is logged in Notes as already used, find a new one.
- **Keep Notes as an attack playbook.** Good: "Boolean map keys — Go returns 'boolean', TS returns 'string'. Tested in 300_bool_map_key." Bad: "Good progress finding bugs."

## Notes

### Run 1 — Map value writer bug (SUCCESS)
- **Bug found:** `getMapValueWriter()` in main.go only handles `int32`, `string`, `bool`, `enum`. All other scalar types (`double`, `float`, `int64`, `uint64`, `sint32`, `sint64`, `fixed32`, `fixed64`, `sfixed32`, `sfixed64`, `bytes`, `uint32`) fall through to `.tag(2, WireType.LengthDelimited).string(...)` which is wrong.
- **Test:** `82_map_scalar_value_types` — map fields with every scalar value type.
- **Root cause:** Go function `getMapValueWriter` at ~line 3941 has incomplete switch statement.

### Run 2 — Map fixed key wire type bug (SUCCESS)
- **Bug found:** `getMapKeyWriter()` in main.go groups fixed-width types with their varint counterparts. `fixed32` grouped with `uint32` → `Varint`+`uint32()` instead of `Bit32`+`fixed32()`. Same for `fixed64`, `sfixed32`, `sfixed64`.
- **Test:** `83_map_fixed_key_types` — map fields with fixed32/fixed64/sfixed32/sfixed64 keys.
- **Root cause:** Go function `getMapKeyWriter` at ~line 3947 has incorrect switch groupings.

### Run 3 — Map message-value with fixed keys writer bug (SUCCESS)
- **Bug found:** When map has **message values** + numeric keys, the Go plugin hardcodes `tag(1, WireType.Varint).int32(parseInt(k))` for ALL numeric key types (line 3461). The scalar-value branch correctly uses `getMapKeyWriter()`, but the message-value branch bypasses it entirely.
- **Test:** `84_map_message_value_fixed_keys` — map<fixed32/fixed64/sfixed32/sfixed64, Inner> with message values.
- **Root cause:** Line 3461 in `internalBinaryWrite` message-value branch hardcodes Varint+int32 instead of using `getMapKeyWriter`.
- **Also broken:** `k as any` vs `k` accessor, and `parseInt(k)` vs `BigInt(k)` for 64-bit keys.

### Run 4 — Proto2 required message field optionality bug (SUCCESS)
- **Bug found:** Proto2 `required` message fields should still have `?` optional marker in TypeScript interface. The Go plugin at line ~2149 excludes `LABEL_REQUIRED` from the optional check entirely, but the TS plugin still adds `?` for message types even when `required`.
- **Test:** `85_proto2_required_message` — required message field vs required scalar field.
- **Root cause:** Line ~2149 `field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REQUIRED` prevents adding `?` for required fields, but message types should always get `?` in TS regardless of required label.
- **Also found but not tested:** Proto2 oneof fields — Go adds `optional` label in comments but TS omits it for oneof members. Save for future run.

### Run 5 — Proto2 oneof field label bug (SUCCESS)
- **Bug found:** `getProtoType()` in main.go adds `optional` label for proto2 fields with `LABEL_OPTIONAL`, but doesn't check if the field is a oneof member. Oneof members in proto2 have `LABEL_OPTIONAL` in the descriptor but TS plugin omits the label for them.
- **Test:** `86_proto2_oneof` — proto2 message with oneof containing string/int32/bool fields.
- **Root cause:** `getProtoType()` at line ~2367 checks `isProto2 && LABEL_OPTIONAL` but never checks `field.OneofIndex`. Affects both `@generated from protobuf field:` JSDoc and `internalBinaryRead` case comments.

### Run 6 — Oneof scalar jsonName dropped (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` in main.go has 3 branches for emitting field descriptors. The `scalar && oneofName != ""` branch omits `jsonNameField` from the format string — it only includes `localNameField` and `extraFields` (which has `oneof`). So custom `json_name` on scalar oneof fields is silently dropped from reflection metadata.
- **Also broken:** The JSDoc `@generated from protobuf field:` comment for oneof fields also drops the `[json_name = "..."]` annotation (separate but related code path in the oneof field comment generation).
- **Test:** `87_oneof_json_name` — oneof with scalar fields that have custom json_name values.
- **Root cause:** Line ~2887 in `generateFieldDescriptor()`: the scalar-oneof format string is `{ no: %d, name: "%s", kind: "%s"%s%s, T: %s ... }` where `%s%s` are `localNameField, extraFields` — missing `jsonNameField`. Compare to the non-oneof scalar branch which correctly includes `jsonNameField`.

### Run 7 — Oneof deprecated annotation missing (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go (line ~2238) does NOT include `@deprecated` tag or `[deprecated = true]` annotation in the `@generated from protobuf field:` JSDoc for oneof member fields. The TS plugin includes both.
- **Test:** `88_oneof_deprecated` — oneof with deprecated member fields.
- **Root cause:** The oneof field JSDoc generation at line ~2238 only appends `oneofJsonNameAnnotation` to the `@generated` line. It never checks `field.Options.GetDeprecated()` and never emits `@deprecated`. Compare with regular field JSDoc at lines ~2093-2104 which handles both.

### Run 8 — Oneof jstype annotation missing (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go (line ~2247) does NOT include `[jstype = ...]` annotation in the `@generated from protobuf field:` JSDoc for oneof member fields with int64/uint64 types. The TS plugin includes them.
- **Test:** `89_oneof_jstype` — oneof with int64 `[jstype = JS_NUMBER]` and uint64 `[jstype = JS_STRING]` fields.
- **Root cause:** The oneof field JSDoc at line ~2247 only appends `oneofJsonNameAnnotation` and `oneofDeprecatedAnnotation`. It never checks `field.Options.GetJstype()` and never emits `[jstype = ...]`. Compare with regular field JSDoc at lines ~2072-2081 which handles jstype. Same pattern as run 7's deprecated bug — oneof JSDoc generation is incomplete compared to regular field JSDoc.
- **Related:** `[packed = ...]` annotation is also likely missing for oneof fields, but packed doesn't apply to oneof members (they can't be repeated). The `[default = ...]` annotation is also potentially missing for proto2 oneof members.

### Run 9 — Map binaryReadMap error string underscore bug (SUCCESS)
- **Bug found:** `generateMessageTypeClass()` at line ~3316 reconstructs the proto type name from `fullName` (TypeScript name) using `strings.ReplaceAll(fullName, "_", ".")`. But the `_` in `fullName` can be part of the actual message name (e.g., `My_Container`), not just a nesting separator. This converts `My_Container` to `My.Container` in the `"unknown map entry field for ..."` error string.
- **Test:** `90_map_underscore_message` — message named `My_Container` with a `map<string, int32>` field.
- **Root cause:** Line ~3316 should use `protoName` (which is already passed to the function and uses `.` only for nesting) instead of reconstructing from `fullName`. The `protoName` parameter correctly preserves underscores in message names.
- **Note:** Same bug pattern would affect nested messages with underscored names too (double mangling).

### Run 10 — Nested message oneof comment lookup bug (SUCCESS)
- **Bug found:** `generateOneofField()` at line ~2206 uses `g.file.MessageType[msgIndex]` to look up field indices for source code comment paths. But for nested messages, `msgIndex` is the nested message index within its parent (extracted from `msgPath[len(msgPath)-1]`), NOT a top-level message index. This causes `g.file.MessageType[msgIndex]` to reference the wrong top-level message.
- **Test:** `91_nested_oneof_comment` — `Outer` message (field `name = 1`) with nested `Inner` message containing a oneof with fields `text = 1` and `number = 2`. The Go plugin displays "This is the outer name field" instead of "This is the inner string choice" for `text = 1`, because it looks up comments from `Outer` instead of `Inner`.
- **Root cause:** Two bugs in `generateOneofField`:
  1. Line ~2206: `g.file.MessageType[msgIndex]` accesses top-level messages using a nested message index. Should walk the msgPath to find the actual nested message descriptor.
  2. Line ~2214: `fieldPath = [4, msgIndex, 2, fieldIndex]` constructs a flat path instead of the full nested path (e.g., `[4, parentIdx, 3, nestedIdx, 2, fieldIndex]`).
- **Also broken:** The oneof path at line ~2176 `[4, msgIndex, 8, oneofIndex]` has the same nesting issue.

### Run 11 — Proto2 oneof default annotation missing (SUCCESS)
- **Bug found:** `generateOneofField()` at line ~2251 does NOT include `[default = ...]` annotation in the `@generated from protobuf field:` JSDoc for oneof member fields in proto2. Regular field JSDoc at line ~2098 includes `defaultAnnotation`, but the oneof branch at line ~2251 omits it entirely.
- **Test:** `92_proto2_oneof_default` — proto2 oneof with string/int32/bool fields that have default values.
- **Root cause:** Line ~2251 format string is `"%s %s = %d%s%s%s"` with only `oneofJsonNameAnnotation, oneofJstypeAnnotation, oneofDeprecatedAnnotation`. Missing `defaultAnnotation`. Same pattern as runs 7-9 — oneof JSDoc generation is a subset of regular field JSDoc.

### Run 12 — Oneof trailing blank comment __HAS_TRAILING_BLANK__ leak (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go does NOT strip `__HAS_TRAILING_BLANK__` sentinel from `getLeadingComments()` return value. The marker appears literally in JSDoc output for both oneof declarations (line ~2177) and oneof member fields (line ~2213). Regular field handling at line ~2015 correctly strips it.
- **Test:** `93_oneof_trailing_blank_comment` — oneof declaration and oneof member field with comments ending in blank line.
- **Root cause:** `getLeadingComments()` appends `\n__HAS_TRAILING_BLANK__` (line 524) as a marker. Regular field JSDoc (line 2015-2017) strips it. But oneof declaration JSDoc (line 2177) and oneof field JSDoc (line 2213) iterate over comment lines without stripping the marker first.
- **Two affected paths:** (1) oneof declaration leading comment, (2) oneof member field leading comment. Both emit `__HAS_TRAILING_BLANK__` as literal `* __HAS_TRAILING_BLANK__` in the JSDoc.

### Run 13 — Enum declaration missing detached comments from first value (SUCCESS)
- **Bug found:** `generateEnum()` in main.go does NOT include detached comments from the first enum value as part of the enum declaration JSDoc. In the TS plugin, leading comments before the first enum value (separated by a blank line from the value) are treated as "detached" comments and merged into the parent enum's JSDoc — shown after the enum-level comment and before `@generated`.
- **Test:** `94_enum_value_trailing_blank_comment` — enum with comments before first value that have trailing blank lines (making them detached from the value).
- **Root cause:** The Go plugin's `generateEnum()` only outputs the enum-level leading comment (from `enumPath`) but doesn't call `getLeadingDetachedComments()` for the first value and merge them into the enum JSDoc. The TS plugin does this merge.
- **Additional difference:** The first enum value's leading comment in the expected output is empty (moved to enum-level), while in the Go plugin it would remain on the value.

### Run 14 — Proto2 oneof enum field spurious opt:true (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` in main.go adds `opt: true` for proto2 enum fields in oneofs. The `opt` calculation at lines 2945-2948 checks `isProto2 && LABEL_OPTIONAL && not MESSAGE` but doesn't exclude oneof members. Oneof members have `LABEL_OPTIONAL` in proto2 descriptors but should NOT get `opt: true` — they use a oneof discriminator, not optional semantics.
- **Test:** `95_proto2_oneof_enum` — proto2 message with oneof containing string, int32, and enum fields.
- **Root cause:** Two interacting bugs: (1) `opt` calculation doesn't check `oneofName != ""` to skip oneof members, (2) the "message, enum, or map" field descriptor branch (line 2978-2981) includes `opt` in the format string, while the scalar-oneof branch (line 2973-2977) happens to omit it. So scalar oneof fields are accidentally correct, but enum oneof fields are broken.
- **Note:** Proto2 message fields in oneofs are also technically affected but `opt` is never set for message types (line 2946 excludes TYPE_MESSAGE), so only enum fields trigger the bug.

### Run 15 — Service/method trailing blank comment missing extra separator (SUCCESS)
- **Bug found:** Service and method JSDoc comment blocks strip `__HAS_TRAILING_BLANK__` sentinel but never USE the `hasTrailingBlank` flag. When a service or method comment ends with a blank line, the TS plugin outputs two `*` separator lines (one for the trailing blank + one for the regular separator before `@generated`), but the Go plugin always outputs only one.
- **Test:** `96_service_trailing_blank_comment` — service and method with comments ending in blank line (`//`).
- **Root cause:** Four affected code paths all have the same bug:
  1. Service interface JSDoc (line ~4843): always `g.pNoIndent(" *")` regardless of `hasTrailingBlank`
  2. Method interface JSDoc (line ~4897): always `g.p(" *")` regardless
  3. Service class JSDoc (line ~4947): always `g.pNoIndent(" *")` regardless
  4. Method class JSDoc (line ~5006): always `g.p(" *")` regardless
- Compare with message JSDoc (line ~1861-1868) which correctly checks `if hasTrailingBlank` and outputs two separator lines.

### Run 16 — Oneof detached comments missing (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go (line ~2207) never calls `getLeadingDetachedComments()` for the oneof declaration path. When a comment is separated from the `oneof` keyword by a blank line, it becomes a "detached comment" in protobuf source code info (path `[4, msgIdx, 8, oneofIdx]`). The TS plugin outputs these as `//` style comments before the oneof's JSDoc block. The Go plugin drops them entirely.
- **Test:** `97_oneof_detached_comment` — message with a detached comment before a oneof declaration.
- **Root cause:** Line ~2207 in `generateOneofField`: only calls `getLeadingComments(oneofPath)` but not `getLeadingDetachedComments(oneofPath)`. Compare with `generateField` at line ~2022 which properly handles detached comments.

### Run 17 — Oneof member field detached comments missing (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go never calls `getLeadingDetachedComments()` for individual oneof member field paths. Two sub-bugs:
  1. First oneof member's detached comment should be merged INTO the oneof declaration JSDoc (shown before `@generated from protobuf oneof:`). Go plugin drops it entirely.
  2. Subsequent oneof member's detached comments should be output as `//` style comments before that field's JSDoc. Go plugin drops them entirely.
- **Test:** `98_oneof_member_detached_comment` — oneof with string and int32 fields, each having a detached comment (separated from leading comment by blank line).
- **Root cause:** Line ~2278 constructs `fieldPath` but never calls `getLeadingDetachedComments(fieldPath)`. Compare with `generateField` at line 2022-2046 which properly handles detached comments. The TS plugin handles these by: (1) merging first member's detached comments into the oneof JSDoc, (2) outputting subsequent members' detached comments as `//` blocks before the `/**` JSDoc.

### Run 18 — First method detached comment dropped in service (SUCCESS)
- **Bug found:** `generateServiceClient()` in main.go skips detached comments for the first method (`methodIdx == 0`). The `if methodIdx > 0` guard at line ~4923 prevents fetching detached comments for the first method. The TS plugin outputs them as `//` style comments before the first method's JSDoc, both in the interface and the class body.
- **Test:** `99_service_first_method_detached` — service with a detached comment before the first method (separated from first method's leading comment by a blank line).
- **Root cause:** Two affected code paths: (1) interface generation at line ~4923 `if methodIdx > 0`, (2) class generation at line ~5042 `if methodIdx > 0`. Both skip first method's detached comments. Compare with enum handling (test 94) where first value's detached comments are merged into the enum JSDoc. For services, the TS plugin instead outputs them as `//` comments inside the interface/class body.

### Run 19 — oneofKind field name collision not escaped (SUCCESS)
- **Bug found:** `propertyName()` in main.go only escapes `__proto__` and `toString`. The TS plugin additionally escapes field names that collide with `oneofKindDiscriminator` (default: `"oneofKind"`). A proto field named `oneof_kind` camelCases to `oneofKind`, which the TS plugin escapes to `oneofKind$` with `localName: "oneofKind$"` in the descriptor. The Go plugin leaves it as `oneofKind`.
- **Test:** `100_oneof_kind_field_escape` — message with a `string oneof_kind = 1` field.
- **Root cause:** `propertyName()` at line ~2393 and `needsLocalName()` at line ~2410 only check `__proto__` and `toString`. Missing the `oneofKindDiscriminator` escape from TS plugin's `createTypescriptNameForField()` in `interpreter.js`.
- **Affects:** interface property name, constructor default init, field descriptor `localName`, `internalBinaryRead`, `internalBinaryWrite` — ALL use the unescaped name.

### Run 20 — Service-level detached comments missing (SUCCESS)
- **Bug found:** `generateServiceClient()` in main.go never calls `getLeadingDetachedComments()` for the service path `[6, svcIdx]`. When a comment before the `service` keyword is separated by a blank line from the service's own leading comment, it becomes a "detached comment" in protobuf source code info. The TS plugin outputs these as `//` style comments before both the interface and class JSDoc blocks. The Go plugin drops them entirely.
- **Test:** `101_service_detached_comment` — service with a detached comment (separated from leading comment by blank line).
- **Root cause:** Two affected code paths: (1) interface generation at line ~4878 only calls `getLeadingComments` but not `getLeadingDetachedComments`, (2) class generation at line ~4990 same issue. Compare with message generation at line ~1813 which properly handles detached comments.

### Run 21 — Oneof declaration name oneofKind collision not escaped (SUCCESS)
- **Bug found:** Oneof name escaping in main.go only checks `__proto__` and `toString` at all 5 locations (lines 1943, 2885, 3225, 3346, 3569), but NEVER checks `oneofKind`. A `oneof oneof_kind { ... }` declaration camelCases to `oneofKind`, which collides with the `oneofKindDiscriminator`. The TS plugin uses `createTypescriptNameForField` which escapes it to `oneofKind$`. The Go plugin leaves it as `oneofKind`.
- **Test:** `102_oneof_name_escape` — message with a `oneof oneof_kind { string text; int32 number; }`.
- **Root cause:** Same bug as run 19 but for the **oneof name** rather than a field name. All 5 escape checks for oneof names miss the `oneofKind` discriminator collision.
- **Affects:** interface property name (`oneofKind$:` vs `oneofKind:`), field descriptor `oneof:` value, create() default, internalBinaryRead discriminator, internalBinaryWrite discriminator.

### Run 22 — Field detached comment blank line formatting (SUCCESS)
- **Bug found:** `generateField()` in main.go has two formatting bugs in field-level detached comments:
  1. **Blank line within a detached block**: Go outputs `//` (no trailing space), TS outputs `// ` (with trailing space). Line ~2033 uses `g.p("//")` but should use `g.p("// ")`.
  2. **Separator between detached blocks**: Go outputs `//` (a comment), TS outputs an empty line. Line ~2040 uses `g.p("//")` but should use `g.pNoIndent("")`.
- **Test:** `103_field_detached_comment_blank` — message with field having two detached comment blocks, first block containing a blank line.
- **Root cause:** The message-level detached comment code (line ~1822-1834) correctly uses `g.pNoIndent("// ")` for blank lines and `g.pNoIndent("")` for block separators, but the field-level code (line ~2033-2040) uses `g.p("//")` for both — wrong in both cases.
- **Note:** Same bug likely exists in other `//` detached comment handlers (oneof field, service method). The message-level handler was fixed but field-level was not.

### Run 23 — Service method detached comment block separator missing (SUCCESS)
- **Bug found:** `generateServiceClient()` in main.go at lines 4944-4951 and 5078-5086 does NOT add empty line separators between multiple detached comment blocks for service methods. When a method has two detached comment blocks (two comments each separated by a blank line from the next), the TS plugin outputs an empty line between them, but the Go plugin concatenates them without any separator.
- **Test:** `104_service_method_detached_blocks` — service with a method that has two detached comment blocks before it.
- **Root cause:** Lines 4944-4951 iterate `for _, detached := range detachedComments` but never track the index and never output `g.pNoIndent("")` between blocks. Compare with field-level code at lines 2026-2044 which checks `if idx < len(detachedComments)-1 { g.pNoIndent("") }`. Same bug in class body at lines 5078-5086.

### Run 24 — File-level detached comment blank line formatting (SUCCESS)
- **Bug found:** File-level detached comments (from first message path `[4, 0]`) at lines 791-817 have two formatting bugs identical to run 22's field-level bug:
  1. **Blank line within a detached block**: Go outputs `//` (no trailing space), TS outputs `// ` (with trailing space). Line 803 uses `g.pNoIndent("//")` but should use `g.pNoIndent("// ")`.
  2. **Separator between detached blocks**: Go outputs `//` (a comment), TS outputs an empty line. Line 810 uses `g.pNoIndent("//")` but should use `g.pNoIndent("")`.
- **Test:** `105_file_detached_comment_blank` — proto file with two detached comment blocks before the first message, first block containing a blank line.
- **Root cause:** The message-level detached comment code (line ~1822-1834) was fixed to use `"// "` for blank lines and `""` for block separators, but the file-level code (line ~800-811) was never updated to match.

### Run 25 — Top-level enum detached comments missing (SUCCESS)
- **Bug found:** `generateEnum()` in main.go (line ~4198) does NOT handle detached comments before the enum JSDoc. When a comment before the `enum` keyword is separated from the enum's own leading comment by a blank line, it becomes a "detached comment" in protobuf source code info (path `[5, enumIdx]`). The TS plugin outputs these as `//` style comments before the enum's `/**` JSDoc block. The Go plugin drops them entirely.
- **Test:** `106_enum_detached_comment` — enum with a detached comment (separated from leading comment by blank line).
- **Root cause:** `generateEnum()` at line ~4218 immediately opens with `g.pNoIndent("/**")` without first calling `getLeadingDetachedComments(enumPath)`. Compare with `generateMessageInterface()` at lines 1808-1836 which properly handles detached comments before the `/**`.
- **Note:** Same bug likely applies to nested enums within messages (path `[4, msgIdx, 4, enumIdx]`).

### Run 26 — Oneof declaration missing @deprecated in deprecated file (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go (line ~2233-2270) does NOT add `@deprecated` tag to the oneof declaration JSDoc when the file is deprecated (`option deprecated = true`). The TS plugin's `CommentGenerator.isDeprecated()` checks `desc.parent.file.deprecated` for oneof descriptors, adding `@deprecated` to the oneof declaration when the entire file is deprecated.
- **Test:** `107_deprecated_file_oneof` — proto3 file with `option deprecated = true` containing a message with a `oneof choice { string text; int32 number; }`.
- **Root cause:** Lines 2233-2270 in `generateOneofField` only handle leading comments, trailing comments, and detached comments for the oneof declaration JSDoc, but never check `g.isFileDeprecated()`. Compare with field JSDoc at line ~2131 which checks `g.isFileDeprecated()`, and with oneof **member** fields at line ~2367 which correctly checks both `fieldIsDeprecated` and `g.isFileDeprecated()`.
- **Note:** Protobuf doesn't support `deprecated` option directly on `oneof` declarations, so the only way an oneof declaration gets `@deprecated` is through file-level deprecation.

### Run 27 — Field annotation brackets and ordering bug (SUCCESS)
- **Bug found:** When a field has multiple proto options (e.g., `packed` + `json_name`, or `jstype` + `deprecated`), the Go plugin outputs each option in its own separate brackets `[json_name = "vals"] [packed = false]`, while the TS plugin combines them into a single bracket with comma separation `[packed = false, json_name = "vals"]`.
- **Also broken:** The option ordering differs. TS plugin uses: `packed`, `default`, `json_name`, `jstype`, `deprecated` (from `getDeclarationString` in `@bufbuild/protoplugin`). Go plugin uses: `default`, `json_name`, `jstype`, `packed`, `deprecated`.
- **Test:** `108_field_multi_options` — repeated int32 field with both `[packed = false, json_name = "vals"]`.
- **Root cause:** The Go plugin constructs each annotation as a separate format string (e.g., `jsonNameAnnotation = " [json_name = ...]"`, `packedAnnotation = " [packed = ...]"`) and concatenates them. The TS plugin collects all options into a `string[]` array and joins with `", "` inside a single `[...]`. Three affected code paths: (1) interface JSDoc at line ~2138, (2) internalBinaryRead comment at line ~3329, (3) internalBinaryWrite comment at line ~3568.
- **Additional difference:** Import ordering for `WireType` also differs in this test but may be a separate issue.

### Run 28 — Message trailing comment dropped (SUCCESS)
- **Bug found:** `generateMessageInterface()` in main.go never calls `getTrailingComments(msgPath)` for message declarations. The TS plugin uses `addCommentsForDescriptor(statement, descMessage, 'appendToLeadingBlock')` which appends the message's trailing comment (comment between `{` and first member) into the JSDoc block, separated by a blank line from the leading comment.
- **Test:** `109_message_trailing_comment` — message with trailing comment (`// Trailing comment on Foo` after `{`), and empty message with only a trailing comment.
- **Root cause:** `generateMessageInterface()` at lines 1840-1880 only calls `getLeadingComments(msgPath)` but never `getTrailingComments(msgPath)` or `getEnumTrailingComments(msgPath)`. Compare with `generateEnum()` at line 4126 which correctly calls `getEnumTrailingComments(enumPath)` and appends trailing comments into the JSDoc.
- **Affects:** Only the `export interface` JSDoc. The `export const` JSDoc and `$Type` class `// @generated` comment do not include trailing comments in either plugin.
- **Also broken:** The message class `$Type` JSDoc (line ~3555) also likely misses trailing comments but the TS plugin doesn't add them there either, so no diff.

### Run 29 — Service and method trailing comments dropped (SUCCESS)
- **Bug found:** `generateServiceClient()` in main.go never calls `getTrailingComments()` or `getEnumTrailingComments()` for service or method paths. The TS plugin's `addCommentsForDescriptor` uses `'appendToLeadingBlock'` mode which appends trailing comments into the JSDoc block, separated by a blank line from the leading comment — for both services and methods.
- **Test:** `110_service_trailing_comment` — service and method each with trailing comments (`// Trailing comment on service` after `{`, `// Trailing comment on method` after `;`).
- **Root cause:** Four affected code paths:
  1. Interface service JSDoc (line ~4826): only `getLeadingComments`, no trailing.
  2. Class service JSDoc (line ~4964): only `getLeadingComments`, no trailing.
  3. Interface method JSDoc (line ~4889): only `getLeadingComments`, no trailing.
  4. Class method JSDoc (line ~5032): only `getLeadingComments`, no trailing.
- Compare with `generateMessageInterface()` at line 1847 which correctly calls `getEnumTrailingComments(msgPath)`.
- **Affects:** Both interface and class JSDoc for services, and both interface and class method JSDoc.

### Run 30 — Client file UnaryCall import position wrong when first method is streaming (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go always emits `UnaryCall` import at the very end of the import block (line ~4769), after all streaming call types and method type imports. But the TS plugin emits it BEFORE `stackIntercept` (right after the service constant import) when the first method is streaming. The TS plugin processes imports in declaration order, so `UnaryCall` (referenced by a subsequent unary method) appears earlier in the import list.
- **Test:** `111_client_streaming_first_unary_import` — service where first method is `rpc Watch(Request) returns (stream Response)` and second method is `rpc DoSomething(Request) returns (Response)`.
- **Root cause:** Lines 4766-4769 emit `UnaryCall` unconditionally at the end of all imports, but should emit it before `stackIntercept` when the first method is streaming. The TS plugin's import emission is driven by code generation order — as it generates method signatures, it imports types as needed. The Go plugin groups imports in a fixed order that doesn't account for the first-method-streaming case.
- **Correct order (TS):** RpcTransport → ServiceInfo → ServiceConst → **UnaryCall** → stackIntercept → Res → Req → ServerStreamingCall → RpcOptions
- **Wrong order (Go):** RpcTransport → ServiceInfo → ServiceConst → stackIntercept → Res → Req → ServerStreamingCall → **UnaryCall** → RpcOptions

### Run 31 — String default value quote escaping bug (SUCCESS)
- **Bug found:** `escapeForTypeScriptStringLiteral()` in main.go handles `\"` (backslash-quote in C-escaped string) by writing `\\"` (3 chars: backslash, backslash, quote). But the TS plugin's `getDeclarationString()` uses `.replace('"', '\\"')` which only escapes the FIRST occurrence of `"` with a single backslash. The Go plugin's result strips the backslash entirely because `escapeForTypeScriptStringLiteral` writes `\\"` which in the Go raw string `` `\\"` `` is actually `\\` + `"` — two backslashes then a quote — but the TS output shows only `\"` (one backslash, one quote).
- **Test:** `112_string_default_with_quotes` — proto2 message with string field `[default = "hello \"world\""]`.
- **Root cause:** `escapeForTypeScriptStringLiteral` at line ~3681-3684 handles `\"` by writing `\\"` (Go raw literal), but the actual output discards the first backslash, producing `"hello "world""`. The TS plugin outputs `"hello \"world""` — note only the FIRST escaped quote gets a backslash, the second doesn't (because JS `.replace()` without `/g` only replaces first match).
- **Affects:** Three code paths: (1) interface JSDoc `@generated from protobuf field:`, (2) `internalBinaryRead` case comment, (3) `internalBinaryWrite` comment. All three show incorrect escaping.

### Ideas for future runs
- String default value with multiple escaped quotes — `.replace()` only escapes first, so `"a\"b\"c"` → `"a\"b"c""` in TS. Test with multiple quotes to expose even more difference.
- Bytes default value with special escaping — `\x00`, `\377`, etc. — Go and TS may format the octal/hex escapes differently.
- String default value with backslash — `default = "hello\\world"` — escaping of literal backslashes may differ.
- String default value with newline — `default = "line1\nline2"` — `\n` in default annotation could cause issues in JSDoc comment output.
- Enum value comments with `__HAS_TRAILING_BLANK__` sentinel — checked, appears fixed at lines 4288-4290.
- Proto2 with `group` fields — verified, output matches.
- `oneof` containing a `bytes` field — verified, write condition correct.
- Proto file with only enums and no messages — checked, output matches.
- Large field numbers (> 2^28) in binary read comments — checked, output matches.
- Proto2 extensions — checked, output matches.
- `toCamelCase` edge cases with special characters — checked double underscore, trailing underscore, leading underscore — all match.
- `propertyName` incomplete reserved property list — checked `constructor`, `valueOf`, `hasOwnProperty` — TS plugin doesn't escape them for field names either, only `__proto__` and `toString`.
- Deeply nested type collision suffix handling in imports.
- Enum oneof fields with custom json_name — check if "message, enum, or map" branch ordering differs.
- Deep nesting (3+ levels) with oneofs — amplifies nested oneof path bug.
- Enum field trailing comments — check if trailing comments on enum values are handled correctly.
- First method detached comment merging for service with NO service-level comment — different edge case.
- Oneof field detached comment blank line formatting — same bug as run 22 likely applies to oneof field detached comments.
- Service method detached comment blank line formatting — same bug pattern in service code. USED in run 23 (block separator missing).
- File-level detached comment blank line formatting — USED in run 24 (both blank line and separator bugs confirmed).
- Syntax-level detached comments (line ~744-778) also use `"//"` for blanks — same bug pattern, likely also differs from TS.
- Enum value detached comments — tested, Go matches TS (no bug found).
- File-level comments from first ENUM (not message) — lines 791-817 only check `file.MessageType`, what about files with enums first? TESTED: Go matches TS (no bug).
- Syntax-level detached comments blank lines — TESTED: Go matches TS, both output `//` without space (no bug).
- Enum-only file detached comments — TESTED: Go matches TS (no bug, comments handled via syntax path).
- Oneof declaration `@deprecated` when only the oneof's parent **message** is deprecated (not file) — unclear if this case exists since proto doesn't have `deprecated` on oneofs directly.
- Service/method `@deprecated` edge cases — file-level deprecation on service methods in client file vs main file.
- Nested enum `@deprecated` from file-level deprecation — does the Go plugin handle this correctly for nested enums?
- `toCamelCase` vs `rt.lowerCamelCase` — verified equivalent for many edge cases (consecutive underscores, leading underscores, digits). Same results.
- Client file generation for multiple services — complex import ordering, potential for import deduplication bugs.
- Service trailing comments — `addCommentsForDescriptor` uses `'appendToLeadingBlock'` for services and methods too. Go plugin may be missing trailing comments on service declarations (similar to the message trailing comment bug).
- Message trailing comment on nested messages — same bug likely applies since `generateMessageInterface` is called recursively for nested messages.
- Message trailing comment with `__HAS_TRAILING_BLANK__` — the enum handler `getEnumTrailingComments` preserves trailing blank info; the message handler would need the same treatment.
- Client file import ordering — CONFIRMED BUG in run 30 for streaming-first+unary case. More import ordering bugs likely exist:
  - Multiple services in a single file — import dedup across services.
  - Client streaming first method — similar ordering issue to server streaming.
  - Bidirectional streaming first method — UnaryCall position likely also wrong.
  - Service with ONLY streaming methods (no unary) — UnaryCall should not be imported at all (verify).
  - Service with types from different files — cross-file import ordering.
  - Two services where second service introduces new types — import position relative to first service's types.