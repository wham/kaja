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

### Run 32 — JS_NORMAL jstype option completely ignored (SUCCESS)
- **Bug found:** The Go plugin completely ignores `[jstype = JS_NORMAL]` on int64/uint64 fields. `JS_NORMAL = 0` is a valid explicit jstype option that means "use the normal representation" (bigint). Multiple code paths affected:
  1. `formatFieldOptionsAnnotation()` at line ~3718: only checks `JS_STRING` and `JS_NUMBER`, skips `JS_NORMAL` → missing `[jstype = JS_NORMAL]` in JSDoc.
  2. `generateFieldDescriptor()` at line ~2963: only adds `L: 2 /*LongType.NUMBER*/` for `JS_NUMBER`, never adds `L: 0 /*LongType.BIGINT*/` for `JS_NORMAL`.
  3. `getBaseTypescriptType()` at line ~2678: only checks `JS_NUMBER` → returns `longType` (string) instead of `bigint`.
  4. `getReaderMethod()`: only checks `JS_NUMBER` → uses `.toString()` instead of `.toBigInt()`.
  5. `getDefaultValue()`: only checks `JS_NUMBER` → returns `"0"` instead of `0n`.
  6. `getWriteCondition()`: derived from `getDefaultValue`, compares against `"0"` instead of `0n`.
- **Test:** `113_jstype_normal` — int64 and uint64 fields with explicit `[jstype = JS_NORMAL]`.
- **Root cause:** Every place that checks jstype options only handles `JS_NUMBER` (and sometimes `JS_STRING`), completely ignoring `JS_NORMAL` (enum value 0). Since `JS_NORMAL` is the "default" enum value, the developer likely assumed it wouldn't be explicitly set, but protobuf does preserve it in the descriptor when explicitly specified.

### Run 33 — optimize_for = CODE_SIZE generates extra methods (SUCCESS)
- **Bug found:** `generateMessageTypeClass()` in main.go always generates `create()`, `internalBinaryRead()`, and `internalBinaryWrite()` methods regardless of `optimize_for` file option. The TS plugin checks `optimizeFor === FileOptions_OptimizeMode.SPEED` before generating these methods. With `option optimize_for = CODE_SIZE;`, the TS plugin omits all three methods and their associated imports, while the Go plugin includes them.
- **Test:** `114_optimize_code_size` — proto3 file with `option optimize_for = CODE_SIZE;` and a simple message.
- **Root cause:** The Go plugin never reads `g.file.Options.GetOptimizeFor()`. Line ~3012 always enters the method generation code paths. The TS plugin's `message-type-generator.ts` checks `optimizeFor` in `generateMessageTypeContent()` and conditionally pushes `create`, `internalBinaryRead`, `internalBinaryWrite` members only when `SPEED`.
- **Affects:** Extra imports (BinaryWriteOptions, IBinaryWriter, WireType, BinaryReadOptions, IBinaryReader, UnknownFieldHandler, PartialMessage, reflectionMergePartial), plus the three method bodies. Massive diff for any non-trivial message.

### Run 34 — optimize_for = LITE_RUNTIME generates extra methods (SUCCESS)
- **Bug found:** `isOptimizeCodeSize()` in main.go (line ~279) only checks for `FileOptions_CODE_SIZE`, not `FileOptions_LITE_RUNTIME`. The TS plugin checks `optimizeFor === FileOptions_OptimizeMode.SPEED` (i.e., skips methods for ANYTHING that isn't SPEED). With `option optimize_for = LITE_RUNTIME;`, the TS plugin omits `create()`, `internalBinaryRead()`, `internalBinaryWrite()` and their imports, while the Go plugin includes them.
- **Test:** `115_optimize_lite_runtime` — proto3 file with `option optimize_for = LITE_RUNTIME;` and a simple message.
- **Root cause:** The fix for run 33 added `isOptimizeCodeSize()` which checks `== CODE_SIZE` specifically. Should check `!= SPEED` instead (or also check `LITE_RUNTIME`). Both `CODE_SIZE` and `LITE_RUNTIME` skip speed-optimized methods in the TS plugin.
- **Affects:** Same as run 33 — extra imports and three method bodies.

### Run 47 — Custom float/double option values silently dropped (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go at lines 472-477 handles `TYPE_FLOAT` and `TYPE_DOUBLE` by consuming the wire bytes (`ConsumeFixed32`/`ConsumeFixed64`) but NEVER appends the value to `result`. The value is assigned to `_` (discarded). The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which correctly deserializes float/double values.
- **Test:** `128_custom_float_option` — message with `option (weight) = 0.75` (float) and `option (threshold) = 99.5` (double).
- **Root cause:** Lines 472-474 (`TYPE_FLOAT`): `_, n := protowire.ConsumeFixed32(unknown)` — discards value. Lines 475-477 (`TYPE_DOUBLE`): `_, n := protowire.ConsumeFixed64(unknown)` — discards value. Neither appends to `result`. The fix would be to decode the raw bits with `math.Float32frombits()`/`math.Float64frombits()` and append.
- **Affects:** All four custom option types (message, field, method, service) when an extension uses float or double type.

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
  - Two services where second service introduces new types — import position relative to first service's types.- `option optimize_for = CODE_SIZE` — USED in run 33 (Go always generates speed-optimized methods, TS skips them for CODE_SIZE).
- `option optimize_for = LITE_RUNTIME` — likely same bug as CODE_SIZE, may also affect other code paths.
- Client streaming first method import ordering — TESTED: Go matches TS (no bug).
- Bidi streaming first method import ordering — TESTED: Go matches TS (no bug).
- Two services with overlapping types — TESTED: Go matches TS (no bug).
- optimize_for = CODE_SIZE with services — TESTED: TS plugin doesn't check optimize_for in service generators, Go matches TS (no bug).
- String default with `\n` newline — CONFIRMED BUG: Go doesn't match indentation for continuation lines in JSDoc. Related to run 35's `\r` bug but different manifestation.
- String default with `\r` carriage return — USED in run 35 (Go strips \r entirely).

### Run 35 — String default value carriage return stripped (SUCCESS)
- **Bug found:** `formatDefaultValueAnnotation()` in main.go preserves literal `\r` (carriage return, 0x0D) from the proto descriptor's `default_value` field for string/bytes types, but the `\r` gets stripped during output because Go's string handling or the output pipeline eats lone CR characters. The TS plugin passes the literal `\r` through to the generated TypeScript output, which causes the default value to appear to span two lines (CR moves cursor to start of line, subsequent text overwrites).
- **Test:** `116_string_default_cr` — proto2 message with `optional string with_cr = 1 [default = "line1\rline2"]`.
- **Root cause:** The Go plugin's `formatDefaultValueAnnotation` wraps the raw `DefaultValue` string in quotes without escaping `\r`. When this goes through `fmt.Sprintf` and the output pipeline, the `\r` (0x0D) is silently removed, producing `"line1line2"` instead of the expected output containing a literal CR character. The TS plugin outputs the literal CR, which shows as multi-line text in the generated file.
- **Affects:** Three code paths: (1) interface JSDoc `@generated from protobuf field:`, (2) `internalBinaryRead` case comment, (3) `internalBinaryWrite` field comment. All three show `"line1line2"` instead of `"line1\rline2"` (with literal CR).

### Run 36 — String default value newline JSDoc continuation missing (SUCCESS)
- **Bug found:** When a string default value contains `\n` (literal newline), the `@generated from protobuf field:` line in JSDoc breaks across lines. The TS plugin outputs the continuation with ` * ` prefix (valid JSDoc), but the Go plugin outputs just indentation (no `* ` prefix).
- **Test:** `117_string_default_newline` — proto2 message with `optional string with_newline = 1 [default = "line1\nline2"]`.
- **Root cause:** The Go plugin's `formatFieldOptionsAnnotation` (via `formatDefaultValueAnnotation`) produces a string with a literal newline. When this string is passed to `g.p()` for the `@generated` JSDoc line, the newline splits the output across two `g.p()` calls (or raw output lines). The first line gets `* ` prefix from JSDoc, but the continuation line gets only indentation. The TS plugin's TypeScript printer handles multi-line JSDoc strings by adding ` * ` continuation on each line.
- **Only affects:** Interface JSDoc `@generated from protobuf field:` comments. The `internalBinaryRead` and `internalBinaryWrite` comments use `/* */` block comments where continuation doesn't need `* ` prefix — both plugins match there.
- **Note:** The `\r` was fixed in run 35 by converting to `\n`, but the `\n` continuation format was never addressed.

### Run 37 — Streaming-only service duplicate ServerStreamingCall import (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go emits duplicate `ServerStreamingCall` import in the client file when ALL methods are server-streaming (no unary methods). The grouped branch (line ~4728-4750) emits `ServerStreamingCall` for streaming methods N→1, then method 0's call type emission (line ~4811-4824) emits it AGAIN unconditionally.
- **Test:** `118_streaming_only_service` — service with two server-streaming RPCs (`Watch` and `Follow`) using the same `Req`/`Res` types.
- **Root cause:** Two independent code paths both emit the streaming call type import without deduplication:
  1. Line ~4748-4749: The grouped branch checks `needServer` across all non-method-0 streaming methods and emits `ServerStreamingCall`.
  2. Line ~4811-4824: Method 0's streaming call type is emitted unconditionally without checking if it was already emitted.
- **Affects:** Any service where method 0 AND at least one other method are the same streaming type (server, client, or duplex). The import appears twice in the generated `.client.ts` file.
- **Note:** Same bug applies to `DuplexStreamingCall` and `ClientStreamingCall` — all three streaming call types have the same dedup issue. Only tested with `ServerStreamingCall`.

### Run 38 — UnaryCall import position wrong with multiple streaming types (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go emits `UnaryCall` import AFTER grouped streaming call type imports (`DuplexStreamingCall`, `ClientStreamingCall`), but the TS plugin emits `UnaryCall` BEFORE them (right after the service import). This happens when method 0 is streaming AND there are other streaming methods with different call types AND a unary method.
- **Test:** `119_mixed_streaming_unary_import` — service with server-streaming, client-streaming, duplex-streaming, and unary methods.
- **Root cause:** The grouped branch at lines ~4763-4769 emits `DuplexStreamingCall`/`ClientStreamingCall`/`ServerStreamingCall` for non-method-0 streaming methods. Then at line ~4798, `UnaryCall` is emitted only after the grouped streaming call types. The TS plugin uses prepend semantics where `UnaryCall` (needed by the unary method) gets prepended before streaming call types.
- **Differs from run 30:** Run 30 was one streaming method + one unary. This is multiple streaming types + unary, where the grouped streaming imports all appear before `UnaryCall`.
- **Correct order (TS):** Service → UnaryCall → DuplexStreamingCall → ClientStreamingCall → stackIntercept → types
- **Wrong order (Go):** Service → DuplexStreamingCall → ClientStreamingCall → UnaryCall → stackIntercept → types

### Run 39 — Custom message options missing from MessageType constructor (SUCCESS)
- **Bug found:** `generateMessageTypeClass()` in main.go always calls `super("typeName", [fields])` with exactly 2 arguments. The TS plugin checks if the message has custom options (via extensions of `google.protobuf.MessageOptions`) and passes them as a third argument: `super("typeName", [fields], { "pkg.option_name": value })`.
- **Test:** `120_custom_message_options` — message with custom message options `resource_name = "users"` and `cacheable = true`.
- **Root cause:** Lines 3110-3112 in `generateMessageTypeClass` always emit `super("typeName", []);` or `super("typeName", [fields]);`. Never checks for or includes custom message options. The TS plugin's `message-type-generator.ts` checks `Object.keys(interpreterType.options).length` and pushes a third argument when non-empty.
- **Affects:** Any message with custom `MessageOptions` extensions (e.g., resource annotations, validation markers). The missing options mean runtime code can't access them via `MyMessage.options`.
- **Related bugs:** (1) Field-level custom options (`fi.options = this.readOptions(fd, excludeOptions)`) are also never generated by the Go plugin. (2) Service-level custom options (via `ServiceOptions` extensions) may also be missing from `ServiceType` constructor.

### Run 40 — Enum alias deprecated annotation uses wrong descriptor (SUCCESS)
- **Bug found:** `generateEnum()` in main.go at line ~4365 uses the current (alias) value's `deprecated` option for both the `@deprecated` tag and the `[deprecated = true]` annotation. But the TS plugin uses `getCommentBlock(evDescriptor)` where `evDescriptor = descriptor.values.find(v => v.number === ev.number)` — which finds the FIRST descriptor with that number. So if only the alias is deprecated (not the original), TS shows no deprecated markers, but Go incorrectly shows both.
- **Test:** `121_enum_alias_deprecated` — enum with `allow_alias = true`, where `STATUS_RUNNING = 1` (not deprecated) has an alias `STATUS_STARTED = 1 [deprecated = true]`.
- **Root cause:** Line ~4365 `valueIsDeprecated := value.Options != nil && value.GetOptions().GetDeprecated()` uses the current value. For aliases, it should look up the first value's descriptor (like the TS plugin does) for both `@deprecated` tag and `[deprecated = true]` annotation. Lines 4372-4373 also use the wrong descriptor for `deprecatedAnnotation`.
- **Affects:** Any enum with `allow_alias = true` where the alias has `[deprecated = true]` but the original value doesn't. The Go plugin incorrectly shows `@deprecated` and `[deprecated = true]` on the alias's JSDoc.

### Run 41 — Custom field options missing from field descriptor (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` in main.go never emits `options: { "pkg.ext_name": value }` on field descriptors. The TS plugin's `createFieldInfoLiteral` includes `fieldInfo.options` (set by `fi.options = this.readOptions(fd, excludeOptions)` in the interpreter) as a property assignment when present. The Go plugin has zero code for custom field options.
- **Test:** `122_custom_field_options` — message with fields that have custom field options via `extend google.protobuf.FieldOptions { string label = 50001; bool searchable = 50002; }`.
- **Root cause:** No `getCustomFieldOptions` function exists in main.go. The field descriptor generation at lines ~2860-3055 only handles built-in properties (`no`, `name`, `kind`, `localName`, `jsonName`, `oneof`, `repeat`, `opt`, `T`, `L`, `K`, `V`). Compare with TS plugin's `createFieldInfoLiteral` which checks `if (fieldInfo.options)` and adds the `options` property.
- **Affects:** Any field with custom `FieldOptions` extensions. Runtime code can't access custom options via field info.
- **Note:** Run 39 found the same pattern for message options. This is the field-level variant.

### Run 42 — Custom service options missing from ServiceType constructor (SUCCESS)
- **Bug found:** `generateServiceTypeConst()` in main.go always calls `new ServiceType("name", [methods])` with exactly 2 arguments. The TS plugin's `service-type-generator.ts` checks `if (Object.keys(interpreterType.options).length)` and passes them as a third argument: `new ServiceType("name", [methods], { "pkg.option_name": value })`. The Go plugin has `getCustomMethodOptions` and `getCustomMessageOptions` and `getCustomFieldOptions` but NO `getCustomServiceOptions`.
- **Test:** `123_custom_service_options` — service with custom service options `api_version = "v2"` and `internal = true` via `extend google.protobuf.ServiceOptions`.
- **Root cause:** Line ~5472 in `generateServiceTypeConst` always closes with `]);` after methods. Never reads `svc.Options.ProtoReflect().GetUnknown()` for custom extensions. The TS plugin's interpreter calls `this.readOptions(desc, excludeOptions)` at line 222 of `interpreter.js` for the service descriptor.
- **Affects:** Any service with custom `ServiceOptions` extensions. Runtime code can't access them via `ServiceType.options`.

### Run 43 — Oneof member field trailing comments dropped (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go never calls `getTrailingComments()` for individual oneof member field paths. The TS plugin's `createFieldPropertySignature` is called for each oneof member field, and then `addCommentsForDescriptor(property, descField, 'trailingLines')` adds trailing comments as inline `// comment` after the property declaration. The Go plugin outputs `fieldName: type;` without any trailing comment.
- **Test:** `124_oneof_member_trailing_comment` — oneof with two string fields, each having trailing comments (`// The success value` and `// The error message`).
- **Root cause:** Lines 2363-2393 generate the oneof member field JSDoc and property but never fetch or output trailing comments. Regular field generation at line ~2146 correctly calls `getTrailingComments(fieldPath)` and outputs them as `// comment` after the property.
- **Affects:** Only the interface declaration. The `internalBinaryRead` and `internalBinaryWrite` methods don't output trailing comments for any fields.

### Run 44 — Service-only file import ordering (SUCCESS)
- **Bug found:** In service-only files (no messages, only services with imported types), the Go plugin emits type imports in the wrong order. For each method, the TS plugin outputs response type before request type (due to prepend semantics), but the Go plugin outputs request before response.
- **Test:** `125_service_import_order` — service file importing `types.proto` with two methods `Search(SearchRequest) → SearchResponse` and `Delete(DeleteRequest) → DeleteResponse`.
- **Root cause:** Lines 960-968 build the service type import list by adding output type first, then input type (correct for TS prepend). Then line 982 reverses the entire list, which flips request/response within each method pair. After reversal: [DeleteRequest, DeleteResponse, SearchRequest, SearchResponse] instead of [DeleteResponse, DeleteRequest, SearchResponse, SearchRequest].
- **Correct order (TS):** DeleteResponse, DeleteRequest, SearchResponse, SearchRequest (latest method first, response before request)
- **Wrong order (Go):** DeleteRequest, DeleteResponse, SearchRequest, SearchResponse (latest method first, request before response — reversed pair ordering)
- **Affects:** Only service-only files (`len(g.file.MessageType) == 0`). Files with both messages and services use a different code path that doesn't reverse.

### Run 45 — Custom option key quoting without package prefix (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go (line ~497) always wraps option keys in double quotes (`"key": value`), but the TS plugin only quotes keys that contain dots (i.e., package-qualified names like `"pkg.name"`). When extensions are defined in a file with no `package` declaration, the key has no dots and the TS plugin outputs unquoted keys (`key: value`). The Go plugin incorrectly quotes them.
- **Test:** `126_method_option_key_quoting` — extensions for MethodOptions, ServiceOptions, MessageOptions, and FieldOptions in a file with no package declaration.
- **Root cause:** Line ~497 `fmt.Sprintf("\"%s\": %s", opt.key, valueStr)` always wraps key in quotes. Should check if `opt.key` contains a dot: if yes, quote it; if no, leave it unquoted. The TS plugin's `typescriptLiteralFromValue` function at `interpreter.ts` uses JS property shorthand — unquoted identifiers are valid JS, only dot-containing keys need quoting.
- **Affects:** All four custom option types (message, field, method, service) when the extension is in a file with no package declaration (or in the same package as the extending proto).

### Run 46 — Custom option with enum-typed value dropped (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go (line ~401) handles `TYPE_STRING`, `TYPE_BOOL`, `TYPE_INT32/INT64/UINT32/UINT64` but has NO case for `TYPE_ENUM`. Enum-typed extension values fall through to the `default:` branch (line ~423) which consumes the varint bytes but never adds them to the result. The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which correctly deserializes enum fields AND converts them to their string names (e.g., `"VISIBILITY_PRIVATE"` instead of numeric `1`).
- **Test:** `127_custom_enum_type_option` — message with `option (visibility) = VISIBILITY_INTERNAL` and field with `[(field_visibility) = VISIBILITY_PRIVATE]`, where both options use a custom `Visibility` enum type.
- **Root cause:** Two bugs: (1) `TYPE_ENUM` is missing from the `parseCustomOptions` switch — it silently drops the value. (2) Even if added, the Go plugin would need to look up the enum value NAME (e.g., `"VISIBILITY_INTERNAL"`) from the enum descriptor, since the TS plugin uses `toJson()` which converts enum numbers to their canonical string names.
- **Affects:** All four custom option types (message, field, method, service) when an extension uses an enum type. Both the option value and the containing options object are completely dropped.

### Run 48 — Custom sint32 option value silently dropped (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go has no case for `TYPE_SINT32` or `TYPE_SINT64`. These types use zigzag encoding on the wire (`protowire.VarintType`), so they fall through to the `default:` branch which calls `ConsumeVarint` but never appends the value to `result`. The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which correctly deserializes sint32/sint64 values with zigzag decoding.
- **Test:** `129_custom_sint_option` — message with `option (priority) = -5` where `priority` is a `sint32` extension of `MessageOptions`.
- **Root cause:** Lines 467-473 handle `TYPE_INT32/INT64/UINT32/UINT64` but don't include `TYPE_SINT32/SINT64`. These need zigzag decoding via `protowire.DecodeZigZag()` after `ConsumeVarint`. Without the case, the value is silently consumed and discarded.
- **Affects:** All four custom option types (message, field, method, service) when an extension uses sint32 or sint64 type.
- **Related:** `TYPE_FIXED32/FIXED64/SFIXED32/SFIXED64` are also missing — they need `ConsumeFixed32`/`ConsumeFixed64` with appropriate signed/unsigned interpretation.

### Run 49 — Custom message-typed option value silently dropped (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go has no case for `TYPE_MESSAGE`. Message-typed extension values fall through to the `default` branch (line ~503) which consumes the wire bytes via `ConsumeBytes` but never adds the deserialized value to `result`. The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which correctly deserializes message values into JSON objects.
- **Test:** `130_custom_message_type_option` — message with `option (resource) = { name: "users", readonly: true }` where `resource` is a `ResourceInfo` message extension of `MessageOptions`.
- **Root cause:** Lines 503-515: `TYPE_MESSAGE` hits the `default` case. For `BytesType` wire type, it calls `ConsumeBytes` and advances the pointer, but never deserializes or appends the value. The TS plugin outputs `{ "test.resource": { name: "users", readonly: true } }` as the third argument to `super()`, while the Go plugin omits the third argument entirely.
- **Affects:** All four custom option types (message, field, method, service) when an extension uses a message type. The Go plugin would need to recursively deserialize the message binary using the message type's field descriptors and convert to a JSON-like object.

### Run 50 — Repeated custom option values not merged into array (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go creates one `customOption` per wire occurrence. For repeated extensions (e.g., `repeated string tags`), each `option (tags) = "x"` creates a separate entry `{key: "test.tags", value: "x"}`. The TS plugin merges them into a single entry with an array value: `{ "test.tags": ["alpha", "beta"] }`. The Go plugin outputs duplicate keys: `{ "test.tags": "alpha", "test.tags": "beta" }`.
- **Test:** `131_repeated_custom_option` — message with `option (tags) = "alpha"; option (tags) = "beta";` where `tags` is a `repeated string` extension of `MessageOptions`.
- **Root cause:** `parseCustomOptions` (line ~419) never checks `ext.GetLabel() == LABEL_REPEATED`. It appends each wire value as a separate `customOption`. Then `formatCustomOptions` (line ~680) formats each entry as a separate key-value pair. Should check if the extension is repeated and merge values with the same key into a list/array.
- **Affects:** All four custom option types (message, field, method, service) when an extension uses `repeated` label. Duplicate keys in a JS object literal are technically valid but semantically wrong — only the last value survives.

### Run 51 — Custom bytes-typed option value silently dropped (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go has no case for `TYPE_BYTES`. Bytes-typed extension values fall through to the `default:` branch (line ~511) which calls `ConsumeBytes` but never appends the value to `result`. The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which correctly deserializes bytes values and encodes them as base64 strings (e.g., `"aGVsbG8="` for `"hello"`).
- **Test:** `132_custom_bytes_option` — field with `[(field_metadata) = "hello"]` and `[(field_metadata) = "\x01\x02\x03"]`, message with `option (msg_tag) = "tag1"`, all using `bytes`-typed extensions.
- **Root cause:** Lines 453-510 handle `TYPE_STRING`, `TYPE_BOOL`, `TYPE_ENUM`, `TYPE_INT*`, `TYPE_UINT*`, `TYPE_SINT*`, `TYPE_FIXED*`, `TYPE_SFIXED*`, `TYPE_FLOAT`, `TYPE_DOUBLE`, `TYPE_MESSAGE` but NOT `TYPE_BYTES`. The fix would add a case that calls `ConsumeBytes` and base64-encodes the result (matching the TS plugin's `toJson()` behavior for bytes).
- **Affects:** All four custom option types (message, field, method, service) when an extension uses bytes type. Both the field-level `options:` property and the message-level third constructor argument are dropped.

### Run 52 — Custom 64-bit integer option values formatted as numbers instead of strings (SUCCESS)
- **Bug found:** `parseCustomOptions()` in main.go stores all integer types (including int64, uint64, sint64, fixed64, sfixed64) as `int(v)` which is formatted as a numeric literal in the output. The TS plugin's `readOptions()` uses `type.fromBinary()` + `type.toJson()` which follows the protobuf JSON mapping spec: 64-bit integers are encoded as **strings** (e.g., `"1000"` not `1000`). 32-bit integers remain numbers.
- **Test:** `133_custom_int64_option` — message with custom MessageOptions of types int64, uint64, sint64, fixed64, sfixed64.
- **Root cause:** Five affected type cases in `parseCustomOptions`: TYPE_INT64, TYPE_UINT64, TYPE_SINT64, TYPE_FIXED64, TYPE_SFIXED64 all use `int(v)` then format with `%d`. Should store as string for 64-bit types to match protobuf JSON mapping.
- **Also affected:** `parseMessageValue` at lines 616-629 has the same bug for nested message option values with 64-bit types.
- **Note:** 32-bit types (int32, uint32, sint32, fixed32, sfixed32) correctly remain as numbers in both plugins.

### Run 53 — Nested message option repeated fields not merged into array (SUCCESS)
- **Bug found:** `parseMessageValue()` in main.go (line ~691) does NOT call `mergeRepeatedOptions()` on its result. When a message-typed custom option contains repeated fields (e.g., `repeated string tags`), each wire occurrence of the field creates a separate `customOption` entry. The `formatCustomOptions` then outputs duplicate keys (`tags: "admin", tags: "internal"`) instead of a merged array (`tags: ["admin", "internal"]`).
- **Test:** `134_nested_repeated_option` — message with `option (resource).tags = "admin"; option (resource).tags = "internal";` where `resource` is a `ResourceInfo` message extension with `repeated string tags`.
- **Root cause:** `parseCustomOptions()` at line 545 correctly calls `mergeRepeatedOptions(result)` before returning. But `parseMessageValue()` at line 691 just returns `result` without merging. Since `parseMessageValue` is called recursively from `parseCustomOptions` (line 522), repeated fields inside nested message values are never merged.
- **Affects:** Any message-typed custom option (MessageOptions, FieldOptions, MethodOptions, ServiceOptions) where the message type contains `repeated` fields. The output has duplicate object keys which is semantically wrong in JavaScript.
- **Note:** Same bug would also affect deeply nested messages (message inside message) if they have repeated fields — `parseMessageValue` calls itself recursively (line 673) and never merges.

### Run 54 — Custom option string value quotes not escaped (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go at line 738 wraps string values with `fmt.Sprintf("\"%s\"", val)` without escaping internal double quotes. A custom option like `option (description) = "hello \"world\""` produces `"hello "world""` (invalid JS) instead of `"hello \"world\""` (properly escaped).
- **Test:** `135_custom_option_string_escape` — message with `option (description) = "hello \"world\""` where `description` is a string extension of `MessageOptions`.
- **Root cause:** Line 738 in `formatCustomOptions`: `fmt.Sprintf("\"%s\"", val)` uses raw string interpolation with no escaping. Should use something like `strings.ReplaceAll(val, `"`, `\"`)` or JSON marshaling to properly escape special characters. Same bug exists in `formatCustomOptionArray` at line 768.
- **Affects:** All four custom option types (message, field, method, service) when a string extension value contains double quotes, backslashes, or other characters that need escaping in JavaScript string literals.

### Ideas for future runs
- Custom option string with backslash — `\` needs escaping to `\\` in JS strings, likely also broken in `formatCustomOptions`.
- Custom option string with newline — `\n` in option value would need escaping.
- Custom option string in `formatCustomOptionArray` (repeated string options with quotes) — same bug at line 768.
- Service with only duplex-streaming methods — test for duplicate DuplexStreamingCall import (same bug class as run 37).
- Service with only client-streaming methods — test for duplicate ClientStreamingCall import.
- Proto2 group fields — how does the Go plugin handle groups in terms of field descriptors?
- Deeply nested messages (5+ levels) — test for type name construction correctness.
- Enum prefix detection edge cases — VERIFIED: Go and TS algorithms produce identical results. No bug.
- `exclude_options` file option interaction — TS plugin has `ts.exclude_options` that can suppress custom options.
- Enum alias where ORIGINAL is deprecated but alias is not — TS would show @deprecated on alias too (because it uses first descriptor), Go would not. Reverse of run 40.
- Oneof declaration trailing comment with `__HAS_TRAILING_BLANK__` — the oneof trailing comment handler at line 2302 may have the same sentinel issue.
- Enum value trailing comments — does Go handle trailing comments on enum values? Check lines 4330-4345.
- Custom option with bytes value — USED in run 51 (TYPE_BYTES missing, base64 encoding dropped).
- Custom option with nested message value (message inside message) — would require recursive deserialization.
- Custom field option with message type — same bug as run 49 but for FieldOptions extensions.
- Custom method option with message type — same bug but for MethodOptions.
- Custom service option with message type — same bug but for ServiceOptions.
- Repeated custom option with int/bool/enum types — same bug but different value types.
- Custom enum options on enum declarations — Go plugin has no `getCustomEnumOptions`. BUT TS plugin also doesn't output enum-level options, so no diff (VERIFIED).
- Custom enum value options on enum values — Go plugin has no `getCustomEnumValueOptions`. BUT TS plugin also doesn't output enum-value options, so no diff (VERIFIED).

### Run 55 — Custom option string backslash not escaped (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go at line 738 only escapes double quotes (`"` → `\"`) but NOT backslashes (`\` → `\\`). The TS plugin's `toJson()` properly JSON-serializes strings, escaping all special characters. A custom option like `option (desc) = "path\\to\\file"` produces the raw string `path\to\file` in the descriptor, which the Go plugin wraps as `"path\to\file"` (invalid JS — `\t` = tab, `\f` = form feed), while the TS plugin outputs `"path\\to\\file"`.
- **Test:** `136_custom_option_string_backslash` — message with `option (description) = "path\\to\\file"`.
- **Root cause:** Line 738 `strings.ReplaceAll(val, `"`, `\"`)` escapes only quotes. Should also escape backslashes FIRST (`\` → `\\`), then quotes. Same bug in `formatCustomOptionArray` at line 768.
- **Affects:** All four custom option types (message, field, method, service) when a string extension value contains backslash characters. Produces invalid JavaScript string literals.
- **Related:** Newlines (`\n`), tabs (`\t`), carriage returns (`\r`), null bytes (`\0`) and other control characters would also need escaping for valid JS strings. None of these are handled.

### Run 56 — Custom option string newline not escaped (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go at line 738-740 escapes `\` and `"` but NOT newline characters (`\n`). When a custom option string contains a literal newline (e.g., `option (description) = "line1\nline2"`), the Go plugin outputs a raw newline in the JS string literal, producing `"line1\nline2"` (split across two lines — invalid JS). The TS plugin's `ts.createStringLiteral(value)` properly escapes newlines to `\\n` in the output.
- **Test:** `137_custom_option_string_newline` — message with `option (description) = "line1\nline2"`.
- **Root cause:** Line 738-740 in `formatCustomOptions`: only `strings.ReplaceAll` for `\` and `"`, never for `\n`, `\r`, `\t`, or other control characters. The TS plugin uses TypeScript AST's `createStringLiteral()` which handles all escaping. Same bug in `formatCustomOptionArray` at line 770-772.
- **Affects:** All four custom option types (message, field, method, service) when a string extension value contains newline, tab, or other control characters. Produces invalid JavaScript string literals.

### Ideas for future runs
- Custom option string with tab — `\t` also unescaped, but less likely to cause visible diff since tab might render the same.
- Custom option string in `formatCustomOptionArray` (repeated string with newline) — same bug at line 768.
- Enum alias where ORIGINAL is deprecated but alias is not — TS would show @deprecated on alias too (reverse of run 40).
- Oneof declaration trailing comment with `__HAS_TRAILING_BLANK__` sentinel leak.
- Deeply nested messages (5+ levels) — type name construction.
- Proto2 group fields — field descriptor handling.

### Run 57 — Message-typed custom option uses proto field name instead of JSON name (SUCCESS)
- **Bug found:** `parseMessageValue()` in main.go (line ~605) uses `fd.GetName()` (proto field name, snake_case) as the key for nested message option fields. The TS plugin uses `type.toJson()` which serializes with `jsonName` (lowerCamelCase) by default.
- **Test:** `138_custom_message_option_json_name` — message-typed option with multi-word field names (`display_name`, `is_read_only`, `max_retry_count`).
- **Root cause:** Line 605 `fieldName := fd.GetName()` should use `fd.GetJsonName()` to match the TS plugin's JSON serialization. The `toJson()` method in `@protobuf-ts/runtime` uses `field.jsonName` (lowerCamelCase) by default, not the proto field name.
- **Diff:** Go outputs `{ display_name: "docs", is_read_only: true, max_retry_count: 5 }`, TS outputs `{ displayName: "docs", isReadOnly: true, maxRetryCount: 5 }`.

### Run 58 — Custom options from nested extensions silently dropped (SUCCESS)
- **Bug found:** `buildExtensionMap()` in main.go (lines 338-363) only checks `file.Extension` (top-level extensions) and `depFile.Extension`. It never checks `msg.Extension` — extensions defined inside a message (e.g., `message Foo { extend google.protobuf.FieldOptions { ... } }`). These nested extensions are stored in `msg.Extension` in the protobuf descriptor, not `file.Extension`. The TS plugin resolves them correctly.
- **Test:** `139_nested_extension_option` — extensions for MessageOptions and FieldOptions defined inside a `message Extensions { ... }` wrapper, used on a `User` message.
- **Root cause:** `buildExtensionMap` iterates `g.file.Extension` and `depFile.Extension` but never iterates `msg.Extension` for any message in the file. The extension field numbers from nested extensions are not in the map, so `parseCustomOptions` skips them as unknown fields.
- **Diff:** TS outputs `options: { "test.Extensions.searchable": true }` on the field descriptor and `{ "test.Extensions.resource_name": "users" }` as the third `super()` argument. Go outputs neither — no `options:` on the field, no third argument on `super()`.
- **Affects:** All four custom option types (message, field, method, service) when extensions are defined inside a message rather than at file scope. This is a valid proto pattern (e.g., `google.api.http` is defined inside `google.api.HttpRule`).

### Run 59 — Custom float option scientific notation formatting (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go uses `strconv.FormatFloat(val, 'f', -1, 64)` to format float/double custom option values. The `'f'` format flag always uses fixed-point decimal notation (e.g., `0.00000000000000000001`). The TS plugin uses `type.toJson()` which delegates to JavaScript's native number serialization, producing scientific notation for very small numbers (e.g., `1e-20`).
- **Test:** `140_custom_float_scientific_notation` — message with `option (tiny_value) = 1e-20` where `tiny_value` is a `double` extension of `MessageOptions`.
- **Root cause:** Line 756 `strconv.FormatFloat(val, 'f', -1, 64)` — the `'f'` format never produces scientific notation. Should use `'g'` format or a custom formatter that matches JavaScript's `Number.prototype.toString()` behavior, which uses scientific notation when the exponent is < -6 or >= 21.
- **Diff:** Go outputs `{ "test.tiny_value": 0.00000000000000000001 }`, TS outputs `{ "test.tiny_value": 1e-20 }`.
- **Affects:** Both `formatCustomOptions` (line 756) and `formatCustomOptionArray` (line 790) — any custom option with float/double values in the range where JavaScript would use scientific notation.

### Run 60 — Custom float NaN/Infinity values not quoted as strings (SUCCESS)
- **Bug found:** `formatFloatJS()` in main.go has no handling for `NaN`, `+Inf`, or `-Inf`. Go's `strconv.FormatFloat` outputs `NaN`, `+Inf`, `-Inf` for these special values. The TS plugin's `toJson()` follows the protobuf JSON mapping spec (RFC 7159) which quotes them as strings: `"NaN"`, `"Infinity"`, `"-Infinity"`.
- **Test:** `141_custom_float_nan_infinity` — messages with float and double custom options set to `nan`, `inf`, and `-inf`.
- **Root cause:** `formatFloatJS` (line ~776) only handles `v == 0`, small/large values, and regular numbers. It never checks `math.IsNaN(v)` or `math.IsInf(v, 0)`. Go's `strconv.FormatFloat` returns `NaN`/`+Inf`/`-Inf` which are not valid JS string literals (they're Go format). The TS plugin outputs these as quoted strings per the protobuf JSON mapping spec.
- **Three sub-bugs:** (1) NaN: Go `NaN` vs TS `"NaN"`, (2) +Inf: Go `+Inf` vs TS `"Infinity"`, (3) -Inf: Go `-Inf` vs TS `"-Infinity"`. All three affect both `float` and `double` types.
- **Affects:** Both `formatFloatJS` (line 776) and `formatCustomOptionArray` (line 827) — any custom option with float/double values that are NaN or Infinity. Also affects nested message option float fields via `parseMessageValue`.

### Run 61 — Custom map option field outputs array instead of object (SUCCESS)
- **Bug found:** `parseMessageValue()` in main.go treats map fields inside message-typed custom options as repeated message entries, producing an array of `{key, value}` objects. The TS plugin's `type.toJson()` follows the protobuf JSON mapping spec and converts map fields to JSON objects with string keys.
- **Test:** `142_custom_map_option` — message with `option (resource_config) = { labels: { key: "env", value: "prod" } labels: { key: "team", value: "backend" } }` where `resource_config` has a `map<string, string> labels` field.
- **Root cause:** `parseMessageValue()` at line ~713 handles `TYPE_MESSAGE` by recursing into the nested message descriptor. For map entry messages (which have `options.map_entry = true`), it should instead detect the map entry, extract key and value fields, and produce a JSON object `{ key1: val1, key2: val2 }`. Currently it produces `[{ key: "env", value: "prod" }, { key: "team", value: "backend" }]` — an array of entry objects.
- **Two sub-bugs:** (1) `parseMessageValue` doesn't check `GetMapEntry()` on the nested message descriptor, (2) the `mergeRepeatedOptions` merges duplicate parent field names into an array, but the expected output is a JSON object at the map field level, not an array of entries.
- **Diff:** Go outputs `{ labels: [{ key: "env", value: "prod" }, { key: "team", value: "backend" }] }`, TS outputs `{ labels: { env: "prod", team: "backend" } }`.

### Run 62 — Custom map option integer keys not string-quoted (SUCCESS)
- **Bug found:** `parseMessageValue()` in main.go outputs integer map keys as bare numbers (`1`, `2`) instead of string-quoted keys (`"1"`, `"2"`). The TS plugin's `type.toJson()` follows the protobuf JSON mapping spec (RFC 7159) which requires ALL map keys to be strings, even when the key type is `int32`, `int64`, etc.
- **Test:** `143_custom_map_int_key` — message-typed custom option with `map<int32, string>` and `map<bool, string>` fields. The `int32` keys trigger the bug; `bool` keys already match.
- **Root cause:** `parseMessageValue()` handles map entries by recursing into the map entry message descriptor. It outputs the `key` field value directly (as an integer) without converting to a string. The protobuf JSON mapping spec says: "The order of the key/value pairs is not specified. Map keys are strings." For non-string key types, the key must be converted to its string representation and quoted.
- **Diff:** Go outputs `{ intMap: { 1: "one", 2: "two" }, ... }`, TS outputs `{ intMap: { "1": "one", "2": "two" }, ... }`.
- **Affects:** All integer key types (`int32`, `int64`, `uint32`, `uint64`, `sint32`, `sint64`, `fixed32`, `fixed64`, `sfixed32`, `sfixed64`) in map fields within message-typed custom options. Bool keys are unaffected (both output bare `true`/`false`).

### Run 63 — Custom map string key starting with digit not quoted (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go at line 857 only quotes object keys that contain dots (`strings.Contains(opt.key, ".")`). But the TS plugin uses `validPropertyKey = /^(?![0-9])[a-zA-Z0-9$_]+$/` which also rejects keys starting with a digit. A `map<string, string>` custom option with key `"123abc"` produces `123abc: "val"` (invalid JS identifier) in the Go plugin, but `"123abc": "val"` (properly quoted) in the TS plugin.
- **Test:** `144_custom_map_digit_key` — message-typed custom option with `map<string, string>` where one key starts with a digit.
- **Root cause:** Line 857 `strings.Contains(opt.key, ".")` is too narrow. Should use a regex like `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/` or equivalent check to determine if a key is a valid JS identifier. The TS plugin's `typescriptLiteralFromValue` uses `validPropertyKey.test(key)` which correctly rejects digit-leading keys.
- **Affects:** Any `map<string, *>` field inside a message-typed custom option where the string key starts with a digit. Produces invalid JavaScript syntax.
- **Related:** Keys containing special characters (spaces, hyphens, etc.) would also fail, but those can't be proto map keys since proto restricts key types to strings, ints, and bools.

### Ideas for future runs
- Extensions defined inside nested messages (2+ levels deep) — same bug amplified.
- Custom option with `oneof` field inside message-typed option — Go `parseMessageValue` doesn't handle oneofs.
- Custom option where extension is imported from a different file and defined inside a message in THAT file — same `buildExtensionMap` bug for dep files.
- Enum alias where ORIGINAL is deprecated but alias is not — reverse of run 40.
- Oneof declaration trailing comment with `__HAS_TRAILING_BLANK__` sentinel leak.
- Proto2 group fields — field descriptor handling.
- Deeply nested messages (5+ levels) — type name construction.
- Float formatting for nested message option float fields — same `formatCustomOptions` bug applies recursively.
- Float formatting in `formatCustomOptionArray` — repeated float options with very small values.
- NaN/Infinity in nested message float fields — same bug as run 60 but inside message-typed options.
- Negative zero (`-0.0`) — Go `formatFloatJS` returns `"0"` for `v == 0`, but `-0.0 == 0` is true in Go. TS `toJson()` may output `0` or `-0` differently.
- Map option with message values — similar bug, map values would be nested entry objects instead of direct values.
- Map option with enum values — enum map values would use entry object format instead of string enum names.
- Int64/uint64 map keys — should be quoted as strings, likely same bug as int32.
- Bool map keys in custom options — both plugins output bare `true`/`false`, but JSON spec says keys must be strings, so maybe `"true"`/`"false"` is needed. Need to verify TS behavior.
- Map string keys with other special chars (hyphens, spaces) — same quoting bug but requires non-proto-standard key values.

### Run 64 — Packed repeated scalar fields in message-typed custom options crash (SUCCESS)
- **Bug found:** `parseMessageValue()` in main.go doesn't handle packed repeated scalar fields. In proto3, `repeated int32` (and other packable scalar types) use packed encoding by default — all values are in a single LengthDelimited wire entry. `parseMessageValue` switches on `fd.GetType()` (e.g., `TYPE_INT32` → `ConsumeVarint`), but doesn't check the wire type. When a packed field arrives as `BytesType`, the code tries to read the LENGTH byte as a varint value, then corrupts subsequent field parsing, causing a **panic** (`slice bounds out of range [-1:]`).
- **Test:** `145_custom_option_packed_repeated` — message-typed custom option with `repeated int32 codes` set via `option (resource_config).codes = 10; option (resource_config).codes = 20; option (resource_config).codes = 30;`.
- **Root cause:** `parseMessageValue` (line ~628) reads `num, typ, n := protowire.ConsumeTag(data)` but never checks `typ` against the expected wire type. For packed fields, `typ` is `BytesType` (2) but the code falls to the `TYPE_INT32` case which calls `ConsumeVarint`. This reads the packed LENGTH byte as the value, then the remaining packed data corrupts the tag parser on the next loop iteration.
- **Severity:** CRASH (panic), not just wrong output. Any message-typed custom option with packed repeated scalar fields causes the entire code generation to fail.
- **Affects:** All packable scalar types inside message-typed custom options: int32, int64, uint32, uint64, sint32, sint64, fixed32, fixed64, sfixed32, sfixed64, float, double, bool, enum. All four option scopes (MessageOptions, FieldOptions, MethodOptions, ServiceOptions).
- **Why test 134 passes:** Test 134 uses `repeated string` which is NOT packed (strings are always unpacked), so each value is a separate wire entry and `ConsumeBytes` works correctly.

### Run 65 — Empty service formatting bugs (SUCCESS)
- **Bug found:** `generateServiceTypeConst()` in main.go always outputs `new ServiceType("name", [` on one line and `]);` on a separate line. When a service has zero methods, this produces `[\n]` (two lines). The TS plugin outputs `[]` on a single line for empty method arrays.
- **Also broken:** The client file unconditionally imports `RpcOptions` (line ~5784) even when there are no methods that use it. The TS plugin doesn't import `RpcOptions` for empty services.
- **Test:** `146_empty_service` — service with no methods.
- **Root cause:** Line 6038 `g.pNoIndent("export const %s = new ServiceType(\"%s\", [", ...)` unconditionally opens the array on its own line. When `len(svc.Method) == 0`, the closing `]);` at line 6091 appears on the next line. Should special-case empty methods: `export const X = new ServiceType("name", []);` on one line.
- **Two sub-bugs:** (1) `test.ts` has `[\n]` instead of `[]`, (2) `test.client.ts` has spurious `import type { RpcOptions }` import.

### Run 66 — Enum prefix detection with trailing underscore in enum name (SUCCESS)
- **Bug found:** `detectEnumPrefix()` in main.go computes the UPPER_SNAKE_CASE prefix differently from the TS plugin's `findEnumSharedPrefix()` when the enum name has a trailing underscore. The TS plugin uses regex replacement `replace(/[A-Z]/g, letter => "_" + letter.toLowerCase())` then strips leading `_` then uppercases, then adds `_`. The Go plugin inserts `_` before uppercase letters at i>0, uppercases, then adds `_` only if not already trailing. For `MyEnum_`, TS produces `MY_ENUM__` (double underscore), Go produces `MY_ENUM_` (single). This causes Go to not detect the shared prefix and keep full enum value names.
- **Test:** `147_enum_trailing_underscore_prefix` — enum `MyEnum_` with values `MY_ENUM__UNSPECIFIED`, `MY_ENUM__FOO`, `MY_ENUM__BAR`.
- **Root cause:** Line ~5008 `if !strings.HasSuffix(enumPrefix, "_")` prevents adding a second trailing `_` when the enum name already ends with `_`. But the TS regex naturally produces the double `_` because the conversion inserts `_` before each uppercase, and the trailing `_` from the original name stays as-is.
- **Two affected outputs:** (1) Enum member names: TS strips to `UNSPECIFIED/FOO/BAR`, Go keeps `MY_ENUM__UNSPECIFIED/MY_ENUM__FOO/MY_ENUM__BAR`. (2) Field descriptor EnumInfo tuple: TS includes third element `"MY_ENUM__"`, Go omits it entirely.

### Run 67 — Enum prefix detection with leading underscore in enum name (SUCCESS)
- **Bug found:** `detectEnumPrefix()` in main.go computes the UPPER_SNAKE_CASE prefix differently from the TS plugin's `findEnumSharedPrefix()` when the enum name has a **leading underscore**. The TS regex `replace(/[A-Z]/g, letter => "_" + letter.toLowerCase())` produces `"_foo"` for `"_Foo"`, then strips the leading `_` → `"foo"` → uppercase → `"FOO_"`. The Go plugin's loop inserts `_` before uppercase at i>0: `_` → `__F` → `__Foo` → uppercase `__FOO_`. So TS gets `_FOO_`, Go gets `__FOO_`.
- **Test:** `148_enum_underscore_prefix` — enum `_Foo` with values `_FOO_UNSPECIFIED`, `_FOO_BAR`, `_FOO_BAZ`.
- **Root cause:** The TS regex `replace(/[A-Z]/g, ...)` replaces the first uppercase `F` with `_f`, producing a leading `_`. Then `enumPrefix[0] === "_"` strips it. The Go loop writes the leading `_` literally at i=0 (since it's not uppercase, no underscore is inserted), then at i=1 inserts `_` before `F`, giving `__F`. The Go code never strips a leading underscore.
- **Two affected outputs:** (1) Enum member names: TS strips prefix `_FOO_` to get `UNSPECIFIED/BAR/BAZ`, Go keeps full names `_FOO_UNSPECIFIED/_FOO_BAR/_FOO_BAZ`. (2) Field descriptor EnumInfo tuple: TS includes third element `"_FOO_"`, Go omits it entirely.

### Run 68 — Duplicate ServerStreamingCall import in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go's interleave branch (lines ~5337-5357) emits the streaming call type import for EACH streaming method individually, without deduplication. When multiple methods share the same streaming call type (e.g., two server-streaming methods), `ServerStreamingCall` is imported once per method. The group branch (lines ~5360-5395) correctly uses `needServer`/`needClient`/`needDuplex` booleans to dedup.
- **Test:** `149_multi_server_streaming_import` — service with unary first method + two server-streaming methods. Go emits `import type { ServerStreamingCall }` twice.
- **Root cause:** The interleave branch at line ~5350 does `if sm.callType != method0CallType` per streaming method and emits the call type import each time, but never tracks which call types have already been emitted. The group branch uses boolean flags (`needServer`, etc.) to avoid duplicates.
- **Trigger:** Requires `shouldInterleave=true` (last non-method-0 method is streaming) AND multiple streaming methods with the same call type AND method 0 is NOT the same call type.

### Ideas for future runs
- Empty message (no fields) — check if `super()` constructor differs for empty field array.
- Service with only one method — check formatting edge cases.
- Custom option with `group` type inside message — how does the Go plugin handle `TYPE_GROUP` in `parseMessageValue`?
- Map field where value type is imported from another file — check import ordering.
- Proto2 message with only `extensions` range and no fields — does Go handle this differently?
- Enum with only one value (the zero value) — edge case in prefix detection.
- File with both messages and enums but no services — import ordering edge cases.
- Client file generation for service where ALL methods share the same input/output types — import dedup.
- `toCamelCase` edge cases for method names with consecutive uppercase letters.
- `detectEnumPrefix` with enum names containing consecutive underscores (e.g., `My__Enum`) — same regex vs loop difference.
- Enum name that's already UPPER_SNAKE_CASE (e.g., `MY_STATUS`) — Go would produce `M_Y__S_T_A_T_U_S_` vs TS `_M_Y__S_T_A_T_U_S_` stripped to `M_Y__S_T_A_T_U_S_` — actually same, but worth verifying.

### Run 69 — Client import ordering: streaming call type misplaced in Group branch (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go's "Group" branch (line ~5371) emits all non-streaming types first, then all streaming call types, then streaming message types. But in the TS plugin (prepend model), method N's imports appear ABOVE method N-1's imports because each method's batch is prepended in forward order. When a streaming method (method 2) uses types from method 0 (no new types to import), its `ServerStreamingCall` import should still appear ABOVE the non-streaming method 1's type imports.
- **Test:** `150_client_import_streaming_interleave` — service with 3 methods: `GetUser(UserRequest)→UserResponse` (unary), `GetItem(ItemRequest)→ItemResponse` (unary), `SearchUser(UserRequest)→stream UserResponse` (server streaming). Method 2 reuses method 0's types.
- **Root cause:** The `shouldInterleave` detection at line ~5159 scans N→1 for the first non-method-0 method with new types. Method 2 (streaming) has no new types (all method 0's), so it's skipped. Method 1 (non-streaming) is found → `shouldInterleave = false`. The Group branch then separates non-streaming types from call types. But the TS plugin's prepend model naturally interleaves: method 2's `ServerStreamingCall` is prepended AFTER method 1's `ItemResponse, ItemRequest`, so it appears ABOVE them.
- **Diff:** Expected `ServerStreamingCall` ABOVE `ItemResponse, ItemRequest`. Got `ItemResponse, ItemRequest` ABOVE `ServerStreamingCall`.

### Run 70 — Oneof with underscore name misidentified as proto3 optional (SUCCESS)
- **Bug found:** `generateMessageInterface()` at line ~2547 and `generateMessageTypeClass()` at line ~3679 use a heuristic to detect proto3 optional fields: `oneofName[0] == '_' && fieldCount == 1 && field.GetName() == oneofName[1:]`. But a real oneof named `_value` with a single field `value` matches this heuristic. The TS plugin uses `field.proto.proto3Optional` flag (which is `false` for real oneofs) instead of a heuristic.
- **Test:** `151_oneof_underscore_name` — message with `oneof _value { string value = 2; }` (a real oneof whose name starts with underscore).
- **Root cause:** Lines 2547-2559 and 3679-3684 both use the same broken heuristic. The Go plugin has `field.Proto3Optional` available (used at lines 2793, 3083, 3591) but doesn't use it in the oneof detection heuristic.
- **Affects:** ALL codegen for the field: interface (oneof ADT vs optional scalar), field descriptor (`oneof:` property, `opt:` property), `create()` (oneof init vs scalar default), `internalBinaryRead` (oneof unwrap vs direct assign), `internalBinaryWrite` (oneof kind check vs default value check).
- **Note:** This only triggers when ALL three conditions are met: (1) oneof name starts with `_`, (2) oneof has exactly 1 field, (3) field name equals oneof name minus leading `_`. Unusual but valid proto.

### Run 71 — Duplicate property initialization in create() for colliding camelCase names (SUCCESS)
- **Bug found:** `generateMessageTypeClass()` in main.go generates duplicate `message.x123Y = "";` in the `create()` method when two fields (`x123y` and `x_123_y`) resolve to the same TypeScript property name `x123Y` via `toCamelCase`. The TS plugin deduplicates initialization by checking if a property was already initialized; the Go plugin initializes every field without tracking.
- **Test:** `152_duplicate_property_create` — message with `string x123y = 1` and `string x_123_y = 3` (both resolve to `x123Y`).
- **Root cause:** The `create()` method generation at lines ~3755-3816 iterates all fields and calls `g.getDefaultValue(field)` without tracking which property names have already been initialized. When two different proto fields produce the same camelCase property name, the initialization is emitted twice: `message.x123Y = ""; message.x123Y = "";`.
- **Note:** The TS plugin's `createFieldInfoLiteral` and `create()` generator likely deduplicates via a Set of already-initialized property names.

### Run 72 — Package-level detached comments missing (SUCCESS)
- **Bug found:** `generateFile()` in main.go only handles leading detached comments from the **syntax** declaration (path `[12]`) but NOT from the **package** declaration (path `[2]`). When a comment appears between the syntax and package declarations (or before the package declaration), it becomes a detached comment on the package path. The TS plugin includes both syntax and package detached comments in the file header via `getSyntaxComments` and `getPackageComments`.
- **Test:** `153_package_detached_comment` — proto3 file with a comment between `syntax` and `package` declarations, separated by blank lines.
- **Root cause:** Lines 1324-1367 in the Go plugin only iterate source code info locations looking for `loc.Path[0] == 12` (syntax field). The TS plugin at line 361145-361148 explicitly collects both: `[...getSyntaxComments(file).leadingDetached, ...getPackageComments(file).leadingDetached]`.
- **Note:** The package field number in `FileDescriptorProto` is 2. The Go plugin never checks for `loc.Path == [2]` with `LeadingDetachedComments`.

### Run 73 — Import name collision not aliased (SUCCESS)
- **Bug found:** When a file imports a type from another file that has the SAME name as a type defined in the current file (e.g., both files define `Item`), the TS plugin renames the import with an alias (`import { Item as Item$ } from "./common"`) and uses `Item$` throughout. The Go plugin imports it without an alias (`import { Item } from "./common"`), causing a name collision — both the local `Item` and the imported `Item` would refer to the same binding.
- **Test:** `154_import_name_collision` — `common.proto` defines `common.Item`, `test.proto` defines `test.Item` and references both.
- **Root cause:** The Go plugin's import generation (around `generateImports` or `stripPackage`) doesn't track which type names have already been used in the current file. When two different packages define a type with the same simple name, the TS plugin's `TypeScriptImports` class detects the collision and adds `as Name$` alias. The Go plugin lacks this collision detection entirely.
- **Affects:** import statement, interface property type, field descriptor `T:`, `internalBinaryRead`, and `internalBinaryWrite` — ALL reference the unaliased name.

### Run 74 — Map value type import ordering bug (SUCCESS)
- **Bug found:** When a map field's value type (e.g., `google.protobuf.Value`) and a regular field's type (e.g., `google.protobuf.Struct`) are from the same import file, the Go plugin orders them wrong. The Go plugin scans direct fields first, then nested types (including map entry messages), so map value types are appended AFTER regular field types. After reversal, map value types appear BEFORE regular field types in imports. The TS plugin processes map value types inline during field processing, so they appear in field-number order.
- **Test:** `155_map_value_import_order` — `map<string, google.protobuf.Value>` at field 1, `google.protobuf.Struct` at field 2. Expected: `Value` import before `Struct`. Got: `Struct` before `Value`.
- **Root cause:** In `scanMessage()` at line ~1500, fields are processed first (adding map entry type to messageFieldTypes), then `for _, nested := range msg.NestedType` processes nested types including the synthetic `ValuesEntry` message whose `value` field has type `Value`. So `Value` is appended after `Struct` in messageFieldTypes. After the list is reversed (line ~1542), `Value` ends up before `Struct` — but in the wrong direction (Go has `Struct, Value` in final output, TS has `Value, Struct`).

### Run 75 — No-package import missing (SUCCESS)
- **Bug found:** `generateImport()` in main.go fails to emit `import { Shared } from "./types"` when both the current file and the dependency file have NO `package` declaration. Types from packageless proto files are never matched to their source dependency.
- **Test:** `156_no_package_import` — `types.proto` (no package) defines `Shared`, `test.proto` (no package) imports and uses `Shared`.
- **Root cause:** Line ~1692 in `generateImport`: `if strings.HasPrefix(typeNameStripped, depPkg+".")`. When `depPkg` is `""` (no package), `depPkg+"."` is `"."`. The `typeNameStripped` for `Shared` is `"Shared"` (after `TrimPrefix(typeName, ".")`). `HasPrefix("Shared", ".")` is false → the type never matches any dependency file → no import emitted.
- **Affects:** Any cross-file type reference where both files have no package declaration. The import statement is silently dropped, causing a ReferenceError at runtime. All type usages (interface property, field descriptor `T:`, `internalBinaryRead`, `internalBinaryWrite`) reference the missing import.

### Run 78 — Lowercase-named nested message type resolution bug (SUCCESS)
- **Bug found:** `stripPackage()` in main.go at line ~3339 uses an uppercase-first-letter heuristic (`part[0] >= 'A' && part[0] <= 'Z'`) to find where the package ends and the type name begins. When a parent message starts with a lowercase letter (e.g., `lowercaseParent.Nested`), the parent name is mistakenly treated as part of the package, and only `Nested` is returned instead of `lowercaseParent_Nested`.
- **Test:** `159_lowercase_nested_cross_pkg` — `types.proto` in package `other` defines `lowercaseParent` with nested `Nested`. `main.proto` in package `test` references `other.lowercaseParent.Nested`.
- **Root cause:** Line ~3340: `if len(part) > 0 && part[0] >= 'A' && part[0] <= 'Z'` skips lowercase-starting parts. For FQN `other.lowercaseParent.Nested`, the loop skips `other` and `lowercaseParent` (both lowercase-starting), finds `Nested` at index 2, and returns just `Nested` instead of `lowercaseParent_Nested`.
- **Affects:** Interface property type, field descriptor `T:` value, `internalBinaryRead` method call, `internalBinaryWrite` method call — ALL use `Nested` instead of `lowercaseParent_Nested`. The import IS correct (uses a different code path), creating a mismatch.
- **Note:** Same bug would affect nested enums inside lowercase-named messages from different packages.

### Ideas for future runs
- Same bug but with ENUM nested inside a lowercase-named parent from different package.
- Lowercase-named message from different package used as map VALUE type.
- Three-way collision: local type + two imports with same simple name — TS uses `Item$`, `Item$1`?
- Custom option with oneof field inside message-typed option value.
- Multiple fields colliding on same property name with different types.
- `toCamelCase` collisions with `bool` and `bytes` fields — default value dedup.

### Run 76 — No-package enum option value falls back to numeric (SUCCESS)
- **Bug found:** `resolveEnumValueName()` in main.go constructs FQN as `"." + f.GetPackage() + "." + enum.GetName()`. When a file has NO package, `f.GetPackage()` returns `""`, producing `"..Visibility"` (double dot). But protoc's `ext.GetTypeName()` returns `.Visibility` (single dot). The FQN mismatch causes the lookup to fail, falling back to the numeric value string (e.g., `"2"` instead of `"VISIBILITY_INTERNAL"`).
- **Test:** `157_no_package_enum_option` — no-package file with an enum `Visibility`, a custom `MessageOptions` extension of that enum type, and a message using `option (visibility) = VISIBILITY_INTERNAL`.
- **Root cause:** Line 387 in `resolveEnumValueName`: `fqn := "." + f.GetPackage() + "." + enum.GetName()`. When package is empty: `"." + "" + "." + "Visibility"` = `"..Visibility"` but protoc gives `.Visibility`. Same bug at line 407 in `findEnumInMessage`.
- **Affects:** All custom enum-typed options in no-package proto files. The TS plugin outputs enum value names (via `toJson`), Go plugin outputs numeric string values.

### Run 77 — No-package client file import path wrong (SUCCESS)
- **Bug found:** `getImportPathForType()` in main.go has the same no-package bug as run 75. The `typeInFile()` helper at line 2461 checks `strings.HasPrefix(typeName, pkg+".")` — when `pkg` is empty, this becomes `HasPrefix("Request", ".")` → false. So method input/output types from dependency files with no package are never resolved to those deps. The function falls through to the default at line 2504, returning `"./" + basename(service_file)` — the CURRENT file's path instead of the dependency file's path.
- **Test:** `158_no_package_client_import` — `types.proto` (no package) defines `Request`/`Response`, `test.proto` (no package) defines `service SearchService { rpc Search(Request) returns (Response); }`. Client file imports `Request`/`Response` from `"./test"` instead of `"./types"`.
- **Root cause:** Line 2461 in `typeInFile`: `strings.HasPrefix(typeName, pkg+".")`. When `pkg=""`, `pkg+"."` is `"."`. `HasPrefix("Request", ".")` is false. Same pattern as run 75 (line ~1692) but in the client file generation path (`getImportPathForType`).
- **Affects:** All client files for services in no-package proto files that reference types from other no-package proto files. Import paths point to wrong file.

### Run 79 — 4-level deep nested type import name wrong (SUCCESS)
- **Bug found:** `writeImports()` in main.go only handles up to 3-level nested types (`len(parts) == 1`, `2`, `3`) when constructing import names. For 4+ level nested types (e.g., `Outer.Middle.Inner.Deep`), the code falls through all specific nesting checks and hits the `if !found` fallback which treats it as a top-level message, importing just `Outer` instead of `Outer_Middle_Inner_Deep`.
- **Test:** `160_deep_nested_import` — `dep.proto` defines `Outer.Middle.Inner.Deep` (4-level nested), `test.proto` imports and uses it.
- **Root cause:** Lines 1848-1950 in `writeImports`'s `generateImport` closure: explicit branches for `len(parts) == 1` (top-level), `== 2` (singly-nested), `== 3` (doubly-nested), but NO branch for `len(parts) >= 4`. Same issue in the candidate file search at lines 1720-1780.
- **Affects:** Import statement uses wrong name (`Outer` vs `Outer_Middle_Inner_Deep`). All type references in field descriptors, `internalBinaryRead`, `internalBinaryWrite` likely use the correct underscore-joined name (via `stripPackage`), creating a mismatch with the import.
- **Note:** Same bug would affect 4+ level nested enums, and any nesting depth > 3.

### Run 80 — Multiline trailing comment collapsed to single line (SUCCESS)
- **Bug found:** `generateField()` in main.go at lines 2690-2692 joins multiline trailing comments into a single `//` comment line using `strings.Join(lines, " ")`. The TS plugin's `addCommentsForDescriptor` with `trailingCommentsMode: 'trailingLines'` outputs each line as a separate `// ` trailing comment. When a field has a multiline trailing `/* */` comment, the Go plugin collapses it to one line, while the TS plugin preserves each line.
- **Test:** `161_field_multiline_trailing_comment` — message with `string name = 1; /* The name\n  of the entity */`.
- **Root cause:** Line 2692: `trailingComment = " // " + strings.Join(lines, " ")` collapses all lines into one. Should output each line as a separate `// ` comment after the property declaration, matching the TS plugin's behavior of calling `ts.addSyntheticTrailingComment()` in a loop for each line.
- **Diff:** Expected `name: string; // The name\n    // of the entity `, Got `name: string; // The name of the entity`.
- **Affects:** Only fields with multiline trailing `/* */` comments. Single-line `//` trailing comments are unaffected (they have no newlines).

### Run 81 — Oneof member multiline trailing comment missing // prefix (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go at line 2892-2894 outputs the entire multiline trailing comment in a single `g.p()` call: `g.p("%s: %s; // %s", fieldJsonName, fieldType, fieldTrailingComment)`. When the trailing comment contains `\n`, the `g.p()` function splits it across lines but only adds `g.indent` (8 spaces) to continuation lines — NOT the `// ` prefix. The TS plugin outputs each continuation line with `// ` prefix.
- **Test:** `162_oneof_multiline_trailing_comment` — oneof with `string value = 1; /* The success\n    value returned */`.
- **Root cause:** Line 2894 passes the raw multiline trailing comment to `g.p()`. The `g.p()` function at line 267-295 handles `\n` by adding indent but only adds ` * ` continuation for JSDoc lines (lines starting with ` * `). For `// ` trailing comments, it just adds indent with no `// ` prefix. Compare with regular field handler at lines 2686-2690 which splits by newlines and outputs extra lines separately with `g.p("// %s", extra)`.
- **Diff:** Expected `value: string; // The success\n        // value returned `, Got `value: string; // The success\n        value returned `.
- **Affects:** Only oneof member fields with multiline trailing `/* */` block comments. Single-line `//` trailing comments are unaffected.

### Ideas for future runs
- Same bug but for **enum value** trailing comments — check if `generateEnum` at line 4940-4947 also collapses multiline trailing comments. VERIFIED: enum value trailing comments go into JSDoc (not inline `//`), so they use `g.p(" * %s")` which handles newlines via JSDoc continuation. No bug there.
- Multiline trailing comments on **messages** — the `appendToLeadingBlock` mode appends trailing into JSDoc, not as trailing `//` lines. Already uses newlines correctly.
- Same bug but with trailing comments on **service methods** — TS plugin uses `'trailingLines'` mode for methods too. Worth checking.
- Custom option with oneof field inside message-typed option value.
- Three-way collision: local type + two imports with same simple name.
- Deeply nested messages (5+ levels) — type name construction.
- Enum nested inside lowercase-named parent from different package.
- Service method trailing comment multiline — same bug pattern likely.

### Run 82 — Service client file import name collision not aliased (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go does NOT alias imported types when two different packages export a type with the same simple name. When `alpha.Data` and `beta.Data` are both used in a service, the TS plugin imports `Data` from `alpha` and `Data as Data$` from `beta`, using `Data$` throughout. The Go plugin imports `Data` from only one package (beta) and drops the other import entirely.
- **Test:** `163_service_import_collision` — service with `rpc GetAlpha(alpha.Data) returns (beta.Data)` where both packages define a type named `Data`.
- **Root cause:** Two affected code paths: (1) main service file (`svc.ts`) at import generation: imports both but doesn't alias the collision, producing duplicate `Data` symbols. (2) client file (`svc.client.ts`) at import generation: only imports from one package, completely dropping the other type's import. Both files use unaliased `Data` for both types.
- **Differs from run 73:** Run 73 tested import collision in MESSAGE files (local type vs imported type with same name). This test covers SERVICE files where two EXTERNAL imports collide — a different code path (`generateClientFileContent` and service import generation).
- **Affects:** `import` statement aliasing, interface method signatures, class method signatures, `stackIntercept` type parameters, and service type descriptor `I:`/`O:` references.

### Run 83 — WireType import position wrong with empty first message + service (SUCCESS)
- **Bug found:** When a file has a service AND the first message is empty (no fields), the Go plugin positions the `WireType` import late (after `BinaryWriteOptions`/`IBinaryWriter`), but the TS plugin positions it early (right after `ServiceType`).
- **Test:** `164_empty_message_wiretype_import` — file with `message Empty {}`, `message Request { string query = 1; }`, and a service.
- **Root cause:** Lines 1967-1969 in `writeImports`: when `needsServiceType` is true, `wireTypeEarly` is set from `serviceBeforeMessages` only. But `serviceBeforeMessages` requires ALL messages before the service to be empty (line 1869). When there's a mix (Empty + Request), `allBeforeAreEmpty = false` → `wireTypeEarly = false`. The TS plugin places `WireType` early when the FIRST message is empty, regardless of subsequent messages. The `firstMessageEmpty` check at line 1973 is only used when there's NO service (`needsServiceType = false`), but it should also apply when there IS a service.
- **Diff:** Expected `WireType` at import position 2 (after `ServiceType`), got it at position 4 (after `IBinaryWriter`).

### Run 84 — jsonName field descriptor not escaping special chars (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` in main.go at line 3726 outputs the `jsonName` property value using `fmt.Sprintf(", jsonName: \"%s\"", actualJsonName)` without escaping special JavaScript characters. When a field has `[json_name = "has\"quote"]` or `[json_name = "has\\slash"]`, the Go plugin outputs `jsonName: "has"quote"` (broken JS — unescaped double quote) and `jsonName: "has\slash"` (unescaped backslash). The TS plugin correctly escapes them as `has\"quote` and `has\\slash`.
- **Test:** `165_json_name_escape` — message with fields having custom json_name values containing double quotes and backslashes.
- **Root cause:** Line 3726: `fmt.Sprintf(", jsonName: \"%s\"", actualJsonName)` inserts the raw json_name value. Should first escape `\` → `\\` and `"` → `\"` before embedding in the JS string literal.
- **Affects:** Only the field descriptor in the `super()` constructor call. The `@generated from protobuf field:` JSDoc comment and the interface property name both use the json_name differently (as proto annotation text, not as a JS string literal) and are not affected the same way.
- **Severity:** Produces invalid JavaScript syntax when json_name contains `"` or `\`, causing runtime parse errors.

### Run 85 — Enum value trailing comment trailing whitespace not stripped (SUCCESS)
- **Bug found:** `getTrailingComments()` in main.go (line ~1131) does NOT strip trailing whitespace per line from comment text. It only does `strings.TrimRight(comment, "\n")` on the whole string and strips ONE leading space per line, but never trims trailing spaces/tabs per line. Block-style trailing comments like `/* trailing block */` produce raw text with a trailing space before `*/` which protoc preserves. The TS plugin's TypeScript printer strips trailing whitespace from JSDoc lines; the Go plugin does not.
- **Test:** `166_enum_value_trailing_whitespace` — enum with values having multiline and single-line block-style trailing comments (`/* ... */`).
- **Root cause:** `getTrailingComments()` at line ~1131 lacks per-line `strings.TrimRight(line, " \t")`. Compare with `getEnumTrailingComments()` at line ~1165 which correctly does `strings.TrimRight(line, " \t")` for each line.
- **Affects:** Any enum value with a `/* ... */` trailing comment — the space before `*/` leaks into JSDoc output. Field trailing comments in `//` inline format are also affected but less visually obvious.

### Run 86 — Deep nested enum in custom option not resolved (SUCCESS)
- **Bug found:** `resolveEnumValueName()` in main.go calls `findEnumInMessage()` which only searches 2 levels deep — it checks `msg.EnumType` and `msg.NestedType[i].EnumType`, but NOT `msg.NestedType[i].NestedType[j].EnumType` or deeper. When a custom option uses an enum nested 3+ levels inside a message (e.g., `Outer.Middle.Inner.DeepEnum`), the Go plugin fails to resolve the enum value name and falls back to the numeric value.
- **Test:** `167_deep_nested_enum_option` — service method with custom option containing an enum value from a 3-level nested enum (`Outer.Middle.Inner.DeepEnum`).
- **Root cause:** `findEnumInMessage()` at line ~413 has explicit loops for `msg.EnumType` and `msg.NestedType[i].EnumType` but no recursion for deeper nesting. Should recursively call itself for `msg.NestedType[i]`. The TS plugin uses the protobuf reflection API which handles arbitrary depth.
- **Diff:** Go outputs `deepValue: "1"`, TS outputs `deepValue: "VALUE_A"`.

### Run 87 — Custom option string tab character not escaped (SUCCESS)
- **Bug found:** `formatCustomOptions()` in main.go (lines 944-950) escapes `\`, `"`, `\n`, and `\r` in string option values, but NOT `\t` (tab character). The TS plugin uses TypeScript's `ts.createStringLiteral(value)` which escapes all control characters including tabs. A custom string option containing `\t` produces `"hello\tworld"` in the TS output but `"helloworld"` (literal tab) in the Go output.
- **Test:** `168_custom_option_string_tab` — message with custom string option `"hello\tworld"` containing a tab character.
- **Root cause:** Lines 944-950 in `formatCustomOptions` and lines 1016-1021 in `formatCustomOptionArray` both have incomplete string escaping — they handle `\`, `"`, `\n`, `\r` but miss `\t`, `\b`, `\f`, `\0`, and other control characters.
- **Note:** Same bug exists in `formatCustomOptionArray` for string array elements.

### Run 88 — Syntax detached comment no-space formatting (SUCCESS)
- **Bug found:** File-level detached comments before `syntax` (path `[12]`) that have no space after `//` (e.g., `//NoSpace`) are formatted differently. The TS plugin outputs `//NoSpace` (preserving no-space), but the Go plugin outputs `// NoSpace` (adding an extra space).
- **Test:** `169_syntax_detached_nospace` — proto file with `//NoSpace` style comments before `syntax = "proto3"`.
- **Root cause:** Line ~1352 in `generateFileContent()`: when the comment text has no leading space, the Go plugin still uses `g.pNoIndent("// %s", line)` which inserts a space after `//`. The TS plugin uses `"//" + l` which preserves the original spacing (no space added). The `if strings.HasPrefix(line, " ") { line = line[1:] }` guard correctly handles lines WITH a space, but `// %s` always adds a space for lines WITHOUT one.
- **Note:** Same bug likely exists for package-level detached comments (path `[2]`) at line ~1400. Also likely affects any detached comment handler that uses `// %s` format instead of `//%s`.

### Run 89 — Package detached comment no-space formatting (SUCCESS)
- **Bug found:** Package-level detached comments (path `[2]`) that have no space after `//` (e.g., `//NoSpace`) are formatted differently. The TS plugin outputs `//NoSpace` (preserving no-space), but the Go plugin outputs `// NoSpace` (adding an extra space). Same bug pattern as run 88 but on a different code path.
- **Test:** `170_package_detached_nospace` — proto file with `//NoSpace` style comments before the `package` statement.
- **Root cause:** Line ~1398 in `generateFileContent()`: when the comment text has no leading space, the Go plugin still uses `g.pNoIndent("// %s", line)` which inserts a space after `//`. The guard at line ~1396 `if strings.HasPrefix(line, " ") { line = line[1:] }` handles lines WITH a space, but the `// %s` format always adds space for lines WITHOUT one. Should use `//%s` or conditionally add space.
- **Note:** Same bug likely exists at lines 2513, 4908, 5586, 5770 — any other `// %s` detached comment handler (enum, service method, etc.).

### Run 90 — Import ordering wrong when fields declared out of field-number order (SUCCESS)
- **Bug found:** `collectUsedTypes()` in main.go at lines 1487-1497 sorts message fields by field number before scanning for imported types. The TS plugin processes fields in declaration order (the order they appear in the .proto file). When fields are declared in non-ascending field-number order (e.g., field 2 declared before field 1), the import ordering differs.
- **Test:** `171_reverse_field_order_import` — message with `Beta b = 2` declared first, `Alpha a = 1` declared second. Both types from dep.proto.
- **Root cause:** Lines 1487-1497 use a bubble sort to reorder fields by field number. The TS plugin uses `prepend` semantics on fields in declaration order, so last-declared appears first in imports. The Go plugin reverses the field-number-sorted list, producing a different order when declaration order ≠ field number order.
- **Diff:** Expected `Alpha` import before `Beta` (TS: processes Beta=2 first, then Alpha=1, prepend → Alpha first). Got `Beta` before `Alpha` (Go: sorts Alpha=1 first, Beta=2 second, reverses → Beta first).
- **Fix:** Remove the field number sorting at lines 1487-1497. Process `msg.Field` in declaration order (as returned by protoc) instead of sorting by field number.

### Run 91 — Runtime import name collision not aliased (SUCCESS)
- **Bug found:** When a proto message has the same name as a `@protobuf-ts/runtime` import (`WireType`, `MessageType`, `UnknownFieldHandler`), the TS plugin aliases the runtime import with a `$` suffix (e.g., `import { WireType as WireType$ }`) and uses `WireType$` throughout the generated code (`WireType$.Varint`, `WireType$.LengthDelimited`, `MessageType$<Foo>`, `UnknownFieldHandler$.onRead`). The Go plugin does NOT alias — it imports the runtime symbol unaliased, creating a namespace collision with the local proto-defined type.
- **Test:** `172_runtime_import_collision` — message named `WireType` with a `Container` message referencing it.
- **Root cause:** `writeImports()` in main.go never checks if any locally defined type names collide with runtime import names (`WireType`, `MessageType`, `UnknownFieldHandler`, etc.). The TS plugin's `createTypeScriptFile` detects these collisions and applies `as Name$` aliasing to the runtime import, then uses the aliased name in all generated code.
- **Affects:** Import statement (missing `as WireType$` alias), `class FooType extends MessageType$<Foo>` (uses unaliased `MessageType`), `WireType$.Varint`/`WireType$.LengthDelimited` (uses unaliased `WireType`), `UnknownFieldHandler$.onRead`/`UnknownFieldHandler$.onWrite` (uses unaliased `UnknownFieldHandler`).
- **Severity:** Produces TypeScript code that fails to compile — the local type shadows the runtime type, causing type errors.

### Run 92 — MessageType runtime import collision not aliased (SUCCESS)
- **Bug found:** Run 91 found the `WireType` collision bug and was fixed (commit 3e7fbfe), but the fix ONLY handles `WireType`. The Go plugin's `computeLocalTypeNames()` at line 2157 checks `if g.localTypeNames["WireType"]` but does NOT check for `MessageType` or `UnknownFieldHandler`. A message named `MessageType` collides with the `MessageType` runtime import. The TS plugin aliases it as `import { MessageType as MessageType$ }` and uses `MessageType$<T>` in class definitions. The Go plugin leaves it unaliased.
- **Test:** `173_message_type_collision` — message named `MessageType` with a `Container` referencing it.
- **Root cause:** Line 2157 only checks `"WireType"` collision. Missing checks for `"MessageType"`, `"UnknownFieldHandler"`, and potentially other runtime imports (`reflectionMergePartial`, `PartialMessage`, etc.).
- **Diff:** Expected `import { MessageType as MessageType$ }` and `class MessageType$Type extends MessageType$<MessageType>`, got unaliased `import { MessageType }` and `class MessageType$Type extends MessageType<MessageType>`.
- **Severity:** Produces TypeScript code that fails to compile — local `MessageType` (the exported `const`) shadows the runtime `MessageType` class.
- **Note:** Same bug would affect `UnknownFieldHandler` collision. The fix for WireType was incomplete — it should check all runtime import names.

### Run 93 — ServiceType runtime-rpc import collision not aliased (SUCCESS)
- **Bug found:** When a proto message is named `ServiceType`, it collides with the `ServiceType` import from `@protobuf-ts/runtime-rpc`. The TS plugin aliases the import as `import { ServiceType as ServiceType$ }` and uses `ServiceType$` in the service type constructor call (`new ServiceType$("name", [...])`). The Go plugin imports `ServiceType` unaliased, creating a collision with the locally generated `ServiceType` const (the message type).
- **Test:** `174_service_type_collision` — file with `message ServiceType { string value = 1; }` and a `service SearchService { rpc Search(Request) returns (Response); }`.
- **Root cause:** Line ~1903 `import { ServiceType } from "@protobuf-ts/runtime-rpc"` is always unaliased. Line ~6128 `new ServiceType(...)` uses the unaliased name. The Go plugin's `computeLocalTypeNames()` at lines 2163-2169 only checks `WireType` and `MessageType` (from `@protobuf-ts/runtime`) but NOT `ServiceType` (from `@protobuf-ts/runtime-rpc`). Missing `g.serviceTypeRef` aliasing variable.
- **Diff:** Expected `import { ServiceType as ServiceType$ }` and `new ServiceType$("test.SearchService", [...])`, got unaliased `import { ServiceType }` and `new ServiceType("test.SearchService", [...])`.
- **Affects:** Import statement aliasing and all `new ServiceType(...)` constructor calls for service type consts. Produces TypeScript that fails to compile — local `ServiceType` (message const) shadows the runtime-rpc `ServiceType` class.
- **Note:** Different from runs 91-92 which tested `@protobuf-ts/runtime` imports. This tests `@protobuf-ts/runtime-rpc` imports — a completely separate import path and code section.

### Run 94 — UnknownFieldHandler runtime import collision not aliased (SUCCESS)
- **Bug found:** `computeLocalTypeNames()` in main.go checks `WireType`, `MessageType`, and `ServiceType` for collisions but NOT `UnknownFieldHandler`. When a proto message is named `UnknownFieldHandler`, it collides with the `UnknownFieldHandler` import from `@protobuf-ts/runtime`. The TS plugin aliases the import as `import { UnknownFieldHandler as UnknownFieldHandler$ }` and uses `UnknownFieldHandler$.onRead` / `UnknownFieldHandler$.onWrite` throughout. The Go plugin uses unaliased `UnknownFieldHandler`.
- **Test:** `175_unknown_field_handler_collision` — message named `UnknownFieldHandler` with fields, plus a `Container` message referencing it.
- **Root cause:** `computeLocalTypeNames()` at lines 2167-2178 only checks `WireType`, `MessageType`, `ServiceType`. No `unknownFieldHandlerRef` variable exists (unlike `wireTypeRef`, `messageTypeRef`, `serviceTypeRef`). Lines 2015, 4108, 4354 all hardcode `UnknownFieldHandler` instead of using a ref variable.
- **Diff:** Expected `import { UnknownFieldHandler as UnknownFieldHandler$ }` and `UnknownFieldHandler$.onRead`/`UnknownFieldHandler$.onWrite`, got unaliased `import { UnknownFieldHandler }` and `UnknownFieldHandler.onRead`/`UnknownFieldHandler.onWrite`.
- **Severity:** Produces TypeScript that fails to compile — local `UnknownFieldHandler` (the exported interface/const) shadows the runtime `UnknownFieldHandler` object, which has no `.onRead`/`.onWrite` methods.

### Run 95 — PartialMessage runtime import collision not aliased (SUCCESS)
- **Bug found:** `computeLocalTypeNames()` in main.go checks `WireType`, `MessageType`, `ServiceType`, and `UnknownFieldHandler` for collisions but NOT `PartialMessage`. When a proto message is named `PartialMessage`, it collides with the `import type { PartialMessage }` from `@protobuf-ts/runtime`. The TS plugin aliases the import as `import type { PartialMessage as PartialMessage$ }` and uses `PartialMessage$<T>` in `create()` method signatures. The Go plugin uses unaliased `PartialMessage`.
- **Test:** `176_partial_message_collision` — message named `PartialMessage` with a string field, plus a `Container` message referencing it.
- **Root cause:** `computeLocalTypeNames()` at lines 2170-2185 only checks `WireType`, `MessageType`, `ServiceType`, `UnknownFieldHandler`. No `partialMessageRef` variable exists. Line 2021 hardcodes `import type { PartialMessage }` and line 3901 hardcodes `PartialMessage<T>` instead of using a ref variable.
- **Diff:** Expected `import type { PartialMessage as PartialMessage$ }` and `create(value?: PartialMessage$<PartialMessage>)`, got unaliased `import type { PartialMessage }` and `create(value?: PartialMessage<PartialMessage>)`.
- **Severity:** Produces TypeScript where `PartialMessage<PartialMessage>` is self-referential — the local `PartialMessage` interface shadows the runtime utility type, causing incorrect type resolution.

### Run 96 — BinaryReadOptions import type collision not aliased (SUCCESS)
- **Bug found:** `computeLocalTypeNames()` in main.go checks `WireType`, `MessageType`, `ServiceType`, `UnknownFieldHandler`, `PartialMessage` for collisions but NOT `import type` imports like `BinaryReadOptions`. When a proto message is named `BinaryReadOptions`, it collides with `import type { BinaryReadOptions } from "@protobuf-ts/runtime"`. The TS plugin aliases the import as `import type { BinaryReadOptions as BinaryReadOptions$ }` and uses `BinaryReadOptions$` in `internalBinaryRead` method signatures. The Go plugin uses unaliased `BinaryReadOptions`.
- **Test:** `177_binary_read_options_collision` — message named `BinaryReadOptions` with fields, plus a `Container` message referencing it.
- **Root cause:** `computeLocalTypeNames()` at lines 2172-2191 only checks 5 specific runtime import names. Missing checks for `BinaryReadOptions`, `BinaryWriteOptions`, `IBinaryReader`, `IBinaryWriter` (all `import type` imports from `@protobuf-ts/runtime`).
- **Diff:** Expected `import type { BinaryReadOptions as BinaryReadOptions$ }` and `options: BinaryReadOptions$` in method signatures, got unaliased `import type { BinaryReadOptions }` and `options: BinaryReadOptions`.
- **Severity:** Produces TypeScript where the local `BinaryReadOptions` interface shadows the runtime type import, causing type errors in `internalBinaryRead` and `internalBinaryWrite` method signatures.
- **Note:** Same bug would affect `BinaryWriteOptions`, `IBinaryReader`, `IBinaryWriter` collisions. Also `RpcOptions`/`RpcTransport` in client files.

### Run 97 — BinaryWriteOptions import type collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go checks `WireType`, `MessageType`, `ServiceType`, `UnknownFieldHandler`, `PartialMessage`, `BinaryReadOptions` for collisions but NOT `BinaryWriteOptions`. When a proto message is named `BinaryWriteOptions`, it collides with `import type { BinaryWriteOptions } from "@protobuf-ts/runtime"`. The TS plugin aliases the import as `import type { BinaryWriteOptions as BinaryWriteOptions$ }` and uses `BinaryWriteOptions$` in `internalBinaryWrite` method signatures. The Go plugin uses unaliased `BinaryWriteOptions`.
- **Test:** `178_binary_write_options_collision` — message named `BinaryWriteOptions` with fields, plus a `Container` message referencing it.
- **Root cause:** `collectLocalTypeNames()` at lines 2192-2195 only checks `BinaryReadOptions`. No `binaryWriteOptionsRef` variable exists. Line 2011 imports `BinaryWriteOptions` and line 4190 uses it in `internalBinaryWrite` signatures without aliasing.
- **Diff:** Expected `import type { BinaryWriteOptions as BinaryWriteOptions$ }` and `options: BinaryWriteOptions$`, got unaliased `import type { BinaryWriteOptions }` and `options: BinaryWriteOptions`.
- **Severity:** Produces TypeScript that fails to compile — local `BinaryWriteOptions` interface shadows the runtime type import.

### Run 98 — IBinaryReader runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go checks `WireType`, `MessageType`, `ServiceType`, `UnknownFieldHandler`, `PartialMessage`, `BinaryReadOptions`, `BinaryWriteOptions` for collisions but NOT `IBinaryReader` or `IBinaryWriter`. When a proto message is named `IBinaryReader`, it collides with `import type { IBinaryReader } from "@protobuf-ts/runtime"`. The TS plugin aliases the import as `import type { IBinaryReader as IBinaryReader$ }` and uses `IBinaryReader$` in `internalBinaryRead` method signatures. The Go plugin uses unaliased `IBinaryReader`.
- **Test:** `179_ibinary_reader_collision` — message named `IBinaryReader` with fields, plus a `Container` message referencing it.
- **Root cause:** `collectLocalTypeNames()` at lines 2194-2201 only checks `BinaryReadOptions` and `BinaryWriteOptions`. No `iBinaryReaderRef` variable exists. Lines 2021, 4017, 4154 all hardcode `IBinaryReader` instead of using a ref variable.
- **Diff:** Expected `import type { IBinaryReader as IBinaryReader$ }` and `reader: IBinaryReader$` in method signatures, got unaliased `import type { IBinaryReader }` and `reader: IBinaryReader`.
- **Severity:** Produces TypeScript that fails to compile — local `IBinaryReader` (the exported interface) shadows the runtime type import, causing type errors in `internalBinaryRead` method signatures.
- **Note:** Same bug would affect `IBinaryWriter` collision. Also `reflectionMergePartial`, `ScalarType`, `LongType`, `PbLong`, and other runtime imports.

### Run 99 — IBinaryWriter runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go checks `WireType`, `MessageType`, `ServiceType`, `UnknownFieldHandler`, `PartialMessage`, `BinaryReadOptions`, `BinaryWriteOptions`, `IBinaryReader` for collisions but NOT `IBinaryWriter`. When a proto message is named `IBinaryWriter`, it collides with `import type { IBinaryWriter } from "@protobuf-ts/runtime"`. The TS plugin aliases the import as `import type { IBinaryWriter as IBinaryWriter$ }` and uses `IBinaryWriter$` in `internalBinaryWrite` method signatures (both `writer` param and return type). The Go plugin uses unaliased `IBinaryWriter`.
- **Test:** `180_ibinary_writer_collision` — message named `IBinaryWriter` with fields, plus a `Container` message referencing it.
- **Root cause:** `collectLocalTypeNames()` at lines 2204-2207 only checks `IBinaryReader`. No `iBinaryWriterRef` variable exists. Line 2016 imports `IBinaryWriter` and line 4203 uses it in `internalBinaryWrite` signatures (`writer: IBinaryWriter, ...: IBinaryWriter`) without aliasing.
- **Diff:** Expected `import type { IBinaryWriter as IBinaryWriter$ }` and `writer: IBinaryWriter$` / return type `IBinaryWriter$`, got unaliased `import type { IBinaryWriter }` and `writer: IBinaryWriter` / return type `IBinaryWriter`.
- **Severity:** Produces TypeScript that fails to compile — local `IBinaryWriter` (the exported interface) shadows the runtime type import, causing type errors in `internalBinaryWrite` method signatures.

### Run 100 — RpcOptions runtime-rpc import collision not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go does NOT alias proto type imports when they collide with `@protobuf-ts/runtime-rpc` imports like `RpcOptions`. When a proto message is named `RpcOptions` and used as a service method's response type, the client file imports both `import type { RpcOptions } from "./test"` (proto type) and `import type { RpcOptions } from "@protobuf-ts/runtime-rpc"` (runtime type). The TS plugin aliases the proto import as `import type { RpcOptions as RpcOptions$ } from "./test"` and uses `RpcOptions$` throughout method signatures.
- **Test:** `181_rpc_options_collision` — message named `RpcOptions` used as service method response type.
- **Root cause:** The client file generator has NO collision detection for proto type imports vs runtime-rpc imports. `collectLocalTypeNames()` only handles `@protobuf-ts/runtime` imports (WireType, MessageType, etc.) in the main `.ts` file. The client file generator at lines 5350-5636 never checks if imported proto types collide with `RpcOptions`, `RpcTransport`, `ServiceInfo`, `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, or `stackIntercept`.
- **Diff:** Expected `import type { RpcOptions as RpcOptions$ } from "./test"` and `UnaryCall<Request, RpcOptions$>`, got unaliased `import type { RpcOptions } from "./test"` and `UnaryCall<Request, RpcOptions>`.
- **Affects:** Import statement, interface method return types, class method return types, `stackIntercept` type parameters — ALL use unaliased name, causing TypeScript compile errors.
- **Note:** Same bug would affect `RpcTransport`, `ServiceInfo`, `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, `stackIntercept` collisions — ANY proto type whose name matches a runtime-rpc import.

### Ideas for future runs
- `RpcTransport` collision in client file — same bug as run 100 but with a different runtime-rpc import.
- `reflectionMergePartial` collision — used as a value import, not type import.
- Service method trailing comment multiline — same bug pattern as run 81.
- Three-way collision: local type + two imports with same simple name.
- Enum nested inside lowercase-named parent from different package.
- Custom option with oneof field inside message-typed option value.
- `MessageType` as enum name (not just message name) — does collision detection handle top-level enums?
- `stackIntercept` collision in client file — value import, not type import.
- `UnaryCall` collision in client file — proto message named `UnaryCall` used as method param.

### Run 101 — reflectionMergePartial runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT check for `reflectionMergePartial` collisions. When a proto message is named `reflectionMergePartial`, it collides with `import { reflectionMergePartial } from "@protobuf-ts/runtime"`. The TS plugin aliases the import as `import { reflectionMergePartial as reflectionMergePartial$ }` and uses `reflectionMergePartial$<...>(this, message, value)` in `create()` methods. The Go plugin uses unaliased `reflectionMergePartial`, which causes the message constructor to shadow the runtime function.
- **Test:** `182_reflection_merge_collision` — message named `reflectionMergePartial` with a `string name = 1` field, plus a `User` message referencing it.
- **Root cause:** `collectLocalTypeNames()` at lines 2178-2213 checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter — but NOT `reflectionMergePartial`. This is a value import (not type import), so the collision causes the local message type to shadow the runtime function, breaking the `create()` method.
- **Diff:** Expected `import { reflectionMergePartial as reflectionMergePartial$ }` and `reflectionMergePartial$<...>(this, message, value)`, got unaliased `import { reflectionMergePartial }` and `reflectionMergePartial<...>(this, message, value)`.
- **Severity:** Produces TypeScript that fails at runtime — `reflectionMergePartial` would refer to the message class instead of the runtime function.

### Ideas for future runs
- `ScalarType` collision — similar missing collision check for the runtime enum import.
- `LongType` collision — same pattern.
- `PbLong` / `PbULong` collision — same pattern.
- `typeofJsonValue` collision — same pattern.
- `jsonWriteOptions` collision — same pattern.

### Run 102 — Service name collision with runtime-rpc RpcTransport import (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go does NOT alias `import type { RpcTransport } from "@protobuf-ts/runtime-rpc"` when the proto service is also named `RpcTransport`. The TS plugin detects this collision and aliases the runtime-rpc import as `import type { RpcTransport as RpcTransport$ }`, then uses `RpcTransport$` for the constructor parameter type (`private readonly _transport: RpcTransport$`). The Go plugin uses unaliased `RpcTransport`, creating a duplicate binding.
- **Test:** `183_service_name_rpc_collision` — service named `RpcTransport` with a `Search` method.
- **Root cause:** Lines 5419 `import type { RpcTransport } from "@protobuf-ts/runtime-rpc"` is always emitted unaliased. The `clientRuntimeNames` map at line 5354 only checks for collisions between method INPUT/OUTPUT types and runtime-rpc names, NOT for collisions between service NAMES and runtime-rpc names.
- **Diff:** Expected `import type { RpcTransport as RpcTransport$ }` and `_transport: RpcTransport$`, got unaliased `import type { RpcTransport }` and `_transport: RpcTransport`.
- **Severity:** Produces TypeScript that fails to compile — duplicate `RpcTransport` binding from two different import declarations.
- **Note:** Same bug would affect service names matching `ServiceInfo`, `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, `stackIntercept`, or `RpcOptions`.

### Run 103 — ServiceInfo service name collision not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go only aliases `RpcTransport` when a service name collides with it (lines 5384-5390). When a service is named `ServiceInfo`, the client file imports both `import { ServiceInfo } from "./test"` (service const) and `import type { ServiceInfo } from "@protobuf-ts/runtime-rpc"` (runtime interface). The TS plugin aliases the runtime import as `import type { ServiceInfo as ServiceInfo$ }` and uses `ServiceInfo$` in the class declaration (`implements IServiceInfoClient, ServiceInfo$`). The Go plugin leaves it unaliased.
- **Test:** `184_service_info_collision` — service named `ServiceInfo` with a `Search` method.
- **Root cause:** Lines 5381-5390 only check `service.GetName() == "RpcTransport"`. Missing checks for `ServiceInfo`, `stackIntercept`, `RpcOptions`, `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`.
- **Diff:** Expected `import type { ServiceInfo as ServiceInfo$ }` and `implements IServiceInfoClient, ServiceInfo$`, got unaliased `import type { ServiceInfo }` and `implements IServiceInfoClient, ServiceInfo`.

### Run 104 — Service name UnaryCall collision not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go's service name collision check (lines 5388-5395) only handles `RpcTransport` and `ServiceInfo`, but NOT `UnaryCall`. When a service is named `UnaryCall`, the client file imports `import { UnaryCall } from "./test"` (service const) and `import type { UnaryCall } from "@protobuf-ts/runtime-rpc"` (call type). The TS plugin aliases the service const import as `import { UnaryCall as UnaryCall$ } from "./test"` and uses `UnaryCall$.typeName`, `UnaryCall$.methods`, `UnaryCall$.options` in the class body. The Go plugin leaves it unaliased.
- **Test:** `185_service_name_unary_call_collision` — service named `UnaryCall` with a unary `Search` method.
- **Root cause:** Lines 5388-5395 only check `service.GetName() == "RpcTransport"` and `service.GetName() == "ServiceInfo"`. Missing checks for `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, `stackIntercept`, `RpcOptions`.
- **Note:** Different from the method TYPE collision (run 100 tested `RpcOptions` as method type). This is the SERVICE NAME collision — the service const import `import { UnaryCall } from "./test"` clashes with the runtime-rpc type import. The TS plugin aliases the SERVICE import (not the runtime import), using `UnaryCall$` for `.typeName`, `.methods`, `.options`.

### Run 105 — Service name RpcOptions collision not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go's service name collision check (lines 5388-5407) does NOT check for `RpcOptions`. When a service is named `RpcOptions`, the client file imports `import { RpcOptions } from "./test"` (service const) and `import type { RpcOptions } from "@protobuf-ts/runtime-rpc"` (for method options). The TS plugin aliases the service const import as `import { RpcOptions as RpcOptions$ } from "./test"` and uses `RpcOptions$.typeName`, `RpcOptions$.methods`, `RpcOptions$.options` in the class body. The Go plugin leaves it unaliased.
- **Test:** `186_service_name_rpc_options_collision` — service named `RpcOptions` with a unary `Search` method.
- **Root cause:** Lines 5388-5407 check `RpcTransport`, `ServiceInfo`, and call type names (`UnaryCall`, etc.) but NOT `RpcOptions`. The TS plugin's `createLocalTypeName` checks ALL runtime-rpc imports for collisions with service names.
- **Same pattern as runs 100, 104** — service name collision with runtime-rpc imports. Each run tests a different runtime-rpc name.

### Run 106 — Service name stackIntercept collision not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go's service name collision check (lines 5388-5408) does NOT check for `stackIntercept`. When a service is named `stackIntercept`, the client file imports `import { stackIntercept } from "./test"` (service const) and `import { stackIntercept } from "@protobuf-ts/runtime-rpc"` (runtime function). The TS plugin aliases the service const import as `import { stackIntercept as stackIntercept$ } from "./test"` and uses `stackIntercept$.typeName`, `stackIntercept$.methods`, `stackIntercept$.options` in the class body. The Go plugin leaves it unaliased.
- **Test:** `187_service_name_stack_intercept` — service named `stackIntercept` with a unary `Search` method.
- **Root cause:** Lines 5391-5396 `callTypeNames` includes `UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, `RpcOptions` but NOT `stackIntercept`. Lines 5400-5405 check `RpcTransport` and `ServiceInfo` but NOT `stackIntercept`. The `stackIntercept` function is in `clientRuntimeNames` (for method TYPE collisions) but not in either service NAME collision check.
- **Diff:** Expected `import { stackIntercept as stackIntercept$ } from "./test"` and `stackIntercept$.typeName/methods/options`, got unaliased `import { stackIntercept } from "./test"` and `stackIntercept.typeName/methods/options`.
- **Severity:** Produces TypeScript that fails to compile — duplicate `stackIntercept` binding from two import declarations.

### Run 107 — Duplicate localName create() default uses first field instead of last (SUCCESS)
- **Bug found:** When two fields have different proto names but the same `lowerCamelCase` localName (e.g., `x123y` and `x_1_2_3_y` both → `x123Y`), the `create()` method default value differs. The TS plugin uses `Object.entries(messageType.create())` which calls the runtime's `reflectionCreate` — it iterates all fields and assigns defaults in order, so last-write-wins (`x_1_2_3_y` int32 → `0`). The Go plugin iterates fields with dedup (`fieldNameSeen`) and keeps the FIRST field's default (`x123y` string → `""`).
- **Test:** `188_duplicate_local_name_create` — `string x123y = 1; int32 x_1_2_3_y = 2;` (both camelCase to `x123Y`).
- **Root cause:** Go plugin's `create()` generation at lines ~4002-4013 skips fields whose `fieldName` was already seen (first-wins). TS plugin's `makeMessagePropertyAssignments` calls `messageType.create()` → `reflectionCreate()` which assigns all fields in order (last-wins), then uses `Object.entries()` to emit the final values.
- **Diff:** Expected `message.x123Y = 0;`, got `message.x123Y = "";`.

### Run 108 — Client file syntax detached comment missing block separator (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go at lines 5317-5343 handles syntax-level detached comments differently from the main file handler at lines 1357-1399. When multiple detached comment blocks exist before `syntax = "proto3"`, the main file correctly outputs a `//` trailing newline AND a `//` separator between blocks. The client file handler only outputs ONE `//` after each block (line 5340), missing the between-block separator.
- **Test:** `189_client_syntax_two_blocks` — service file with two syntax-level detached comment blocks.
- **Root cause:** Client file handler at lines 5323-5342 uses a simple `for _, detached` loop with one `g.pNoIndent("//")` after each block. The main file handler at lines 1365-1395 uses `for blockIdx, detached` and outputs both `if hasTrailingNewline { g.pNoIndent("//") }` AND `if blockIdx < len(...)-1 { g.pNoIndent("//") }`. The client file is missing the trailing newline check entirely and uses a single `//` that conflates trailing newline and block separator.
- **Diff:** Expected two `//` lines between blocks, got one.

### Run 109 — Client file package-level detached comments dropped (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go at line 5320 only handles syntax-level (`Path[0] == 12`) detached comments but NOT package-level (`Path[0] == 2`) detached comments. The main file handler has both (lines 1362 and 1404). The TS plugin includes package-level detached comments in the client file (shown after `// tslint:disable` and before imports), but the Go plugin drops them entirely.
- **Test:** `190_client_package_detached` — service file with a detached comment between `syntax` and `package` statements.
- **Root cause:** Line 5320 checks `loc.Path[0] == 12` only. Missing a second loop/check for `loc.Path[0] == 2`. The main file handler at line 1404 has `if len(loc.Path) == 1 && loc.Path[0] == 2 && len(loc.LeadingDetachedComments) > 0` which the client file handler lacks.
- **Diff:** Expected `//\n// This comment is detached from package\n//` between `// tslint:disable` and imports. Got nothing.

### Run 110 — Service name unconditionally aliased even when runtime-rpc type not imported (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go at lines 5435-5453 unconditionally checks whether a service name matches any `callTypeNames` (`UnaryCall`, `ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`, `RpcOptions`, `stackIntercept`) and aliases the service import. But the TS plugin only aliases when there's an **actual collision** — i.e., when the runtime-rpc type is actually imported in the client file. A service named `ServerStreamingCall` with only unary methods never imports `ServerStreamingCall` from runtime-rpc, so there's no collision and the TS plugin leaves it unaliased.
- **Test:** `191_server_streaming_svc_name` — service named `ServerStreamingCall` with a unary `Search` method.
- **Root cause:** Lines 5435-5453 check `callTypeNames[svcName]` without checking whether the corresponding runtime-rpc type is actually needed (i.e., whether any method uses that streaming pattern). The TS plugin's `createLocalTypeName` only aliases when both the local name AND the runtime import are present in the file.
- **Diff:** Expected `import { ServerStreamingCall } from "./test"` and `ServerStreamingCall.typeName/methods/options`, got `import { ServerStreamingCall as ServerStreamingCall$ } from "./test"` and `ServerStreamingCall$.typeName/methods/options`.
- **Note:** Same bug would trigger for `ClientStreamingCall`, `DuplexStreamingCall` as service names with only unary methods — and potentially for `UnaryCall` as service name with only streaming methods (though that would require only server-streaming/client-streaming/bidi methods).

### Run 111 — Message type falsely aliased when runtime-rpc type not imported (SUCCESS)
- **Bug found:** `generateClientFile()` at lines 5400-5425 unconditionally aliases proto message types that match `clientRuntimeNames` (including `DuplexStreamingCall`, `ServerStreamingCall`, `ClientStreamingCall`, etc.), even when the corresponding runtime-rpc type is NOT actually imported. This is the message-type counterpart of run 110's service-name bug.
- **Test:** `192_false_client_alias` — message named `DuplexStreamingCall` used as input to a unary RPC. Since no method uses duplex streaming, `DuplexStreamingCall` is never imported from runtime-rpc, so there's no collision. But the Go plugin aliases `import type { DuplexStreamingCall as DuplexStreamingCall$ }`.
- **Root cause:** Lines 5413-5425 check `clientRuntimeNames[tsName]` without checking `usedCallTypes[tsName]`. The TS plugin's dynamic import tracking only aliases when both the proto type and the runtime-rpc type are present in the file.
- **Diff:** Expected `import type { DuplexStreamingCall } from "./test"` (unaliased), got `import type { DuplexStreamingCall as DuplexStreamingCall$ } from "./test"` (aliased). All references in method signatures also differ.

### Ideas for future runs
- `UnaryCall` as service name with only server-streaming methods — reverse: runtime imports ServerStreamingCall but not UnaryCall, so no collision.
- Enum named `MessageType` — does enum collision detection also alias MessageType?
- Three-way collision: service name + method type + runtime-rpc name.
- Service method trailing comment multiline — same bug pattern as run 81.
- Enum detached comment nospace formatting — `"// %s"` adds space for no-space comments (same pattern as runs 88-89 but different code path).
- Client file detached comment blank line formatting — client handler uses `g.pNoIndent("//")` for blank lines within blocks, should be `g.pNoIndent("// ")` with space.
- Client file message-level detached comments (`Path[0] == 4`) — may also be missing from client file handler.
- Service-level detached comments in client file — does the client file handler process detached comments for `Path[0] == 6`?

### Run 112 — Message type named RpcTransport not aliased in client file (SUCCESS)
- **Bug found:** `generateClientFile()` only checks SERVICE names for `RpcTransport` collision (line 5450), not message type names. When a message named `RpcTransport` is used as a service method input/output, the client file imports both `import type { RpcTransport } from "./test"` (message type) and `import type { RpcTransport } from "@protobuf-ts/runtime-rpc"` (runtime type), which collide. The TS plugin aliases the runtime import to `RpcTransport$`.
- **Test:** `193_message_rpc_transport_collision` — message named `RpcTransport` used as input to a unary RPC in service `Searcher`.
- **Root cause:** Line 5450 only checks `service.GetName() == "RpcTransport"` but never checks if any message type imported into the client file has the same name as a runtime-rpc import. The TS plugin's TypeScript printer automatically handles all name collisions.
- **Diff:** Expected `import type { RpcTransport as RpcTransport$ } from "@protobuf-ts/runtime-rpc"` and `_transport: RpcTransport$`, got unaliased `import type { RpcTransport } from "@protobuf-ts/runtime-rpc"` and `_transport: RpcTransport`.
- **Note:** Same bug would apply to `ServiceInfo` message name colliding with `ServiceInfo` runtime-rpc import.

### Run 113 — stackIntercept message collision aliases wrong import (SUCCESS)
- **Bug found:** When a message named `stackIntercept` is used as a service method input type, the Go plugin aliases the PROTO MESSAGE import (`import type { stackIntercept as stackIntercept$ } from "./test"`) instead of the RUNTIME FUNCTION import. The TS plugin does the opposite: it aliases the runtime function (`import { stackIntercept as stackIntercept$ } from "@protobuf-ts/runtime-rpc"`) and keeps the proto message import unaliased.
- **Test:** `194_message_stack_intercept` — message named `stackIntercept` used as input to a unary RPC.
- **Root cause:** Lines 5428-5437 in `generateClientFile()` add alias to `g.importAliases[typeName]` for the proto message, making the message reference use `$` suffix. But the TS plugin instead aliases the RUNTIME import (`stackIntercept` function) so the proto message type keeps its original name in method signatures.
- **Diff:** Expected runtime aliased `import { stackIntercept as stackIntercept$ } from "@protobuf-ts/runtime-rpc"` + unaliased `import type { stackIntercept } from "./test"`, got runtime unaliased + proto message aliased. Method signatures also differ: expected `stackIntercept` (message type), got `stackIntercept$`.
- **Key insight:** Unlike `RpcTransport`/`ServiceInfo` (which are `import type`), `stackIntercept` is a VALUE import (function). The TS plugin prefers to alias the runtime import and keep proto types unaliased.

### Run 114 — create() integer-like property key ordering (SUCCESS)
- **Bug found:** When a field name starts with `_` followed by digits (e.g., `_123`), `toCamelCase` produces `"123"` — a numeric string that JavaScript treats as an integer index. `Object.entries()` sorts integer indices before string keys. The TS plugin generates `create()` using `Object.entries(defaultMessage)`, so integer-like properties appear first. The Go plugin outputs fields in proto file order, so `"123"` stays in its original position.
- **Test:** `195_underscore_digit_field` — message with `string name = 1; int32 _123 = 2; bool flag = 3;`. TS outputs `message.123 = 0; message.name = ""; message.flag = false;`. Go outputs `message.name = ""; message.123 = 0; message.flag = false;`.
- **Root cause:** Go plugin's `create()` generation iterates `msg.Field` in proto file order. TS plugin uses `Object.entries(messageType.create())` which applies JavaScript's own property enumeration order — integer indices first, then string keys in insertion order.

### Run 115 — Detached comment trailing whitespace trimmed (SUCCESS)
- **Bug found:** Go plugin's detached comment processing trims trailing whitespace from comment lines using `strings.TrimRight(line, " \t")`. The TS plugin preserves trailing whitespace from protobuf source code info verbatim. When a proto `//` comment has trailing spaces (e.g., `// comment text  `), protoc preserves them in SourceCodeInfo. The TS plugin outputs `// comment text  ` (with spaces), while the Go plugin outputs `// comment text` (stripped).
- **Test:** `196_comment_trailing_whitespace` — message and service with detached/leading/field comments that have trailing spaces.
- **Root cause:** Multiple locations in main.go use `line = strings.TrimRight(line, " \t")` when processing comment lines: syntax-level detached comments (lines 1407, 1443), message-level detached comments (line 1477, 2585), field detached comments, service detached comments. The TS plugin's TypeScript printer does not strip trailing whitespace from comment text.
- **Note:** Only `//` style detached comments show the bug. JSDoc `*` style comments trim trailing whitespace in both plugins (the comment content goes through `getLeadingComments` which strips leading space but both plugins happen to not preserve trailing spaces in JSDoc blocks).

### Run 116 — Client file cross-file type name collision not aliased (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go does NOT alias proto type imports when two types from DIFFERENT files have the same TypeScript name. When `Result` exists both locally (in `./main`) and in a dependency (`./dep/shared`), the TS plugin aliases the local type: `import type { Result as Result$ } from "./main"`, and uses `Result$` in method signatures for the local type. The Go plugin skips this aliasing, causing the local `Result` import to be dropped and the dependency `Result` to be used for both.
- **Test:** `197_client_cross_file_type_collision` — `test.Result` (local) and `dep.Result` (external) both used as method input/output types in the same service.
- **Root cause:** The client file's `importAliases` only checks for collisions between proto type names and runtime-rpc import names (stackIntercept, UnaryCall, etc.). It never checks for collisions between types imported from different proto files.
- **Diff:** Expected `import type { Result as Result$ } from "./main"` + `Result$` in method signatures, got no aliased import + `Result` (wrong type) in method signatures.
- **Affects:** Interface method signatures, class method signatures, and `stackIntercept<>` type parameters — all use the wrong `Result` type.

### Run 117 — Whitespace-only leading comment dropped (SUCCESS)
- **Bug found:** When a proto comment contains ONLY whitespace (e.g., `//   `), the Go plugin's `getLeadingComments()` trims it to empty string and drops it. The TS plugin preserves it as a blank comment line in the JSDoc block (`" *\n *"`), which also adds the separator blank line before `@generated`.
- **Test:** `198_whitespace_only_comment` — message and field with whitespace-only comments (`//   `).
- **Root cause:** `getLeadingComments()` uses `strings.TrimRight(comment, " \t\n")` which strips ALL trailing whitespace including the spaces that ARE the comment content. For a comment `"  \n"`, TrimRight produces `""` → empty → no comment output. The TS plugin uses `stripTrailingNewlines()` which only removes `\n` characters, preserving `"  "` as a non-empty comment that produces a blank JSDoc line.
- **Diff:** Expected `/**\n *\n *\n * @generated...`, got `/**\n * @generated...`. Affects both message and field JSDoc blocks.

### Run 118 — Keyword-named parent nested type collision detection broken (SUCCESS)
- **Bug found:** `collectMessageTypeNames()` at line 1297 uses `tsName + "_"` (the escaped TS name) as the prefix for nested types. But `generateMessageInterface()` at line 2731 uses `parentPrefix + baseName + "_"` (the raw proto name) as the prefix. When a parent message has a TypeScript reserved name (e.g., `object`), the collision detection registers nested types with a `$` in the prefix (`object$_Bar`) while the generated code uses the raw prefix (`object_Bar`). This causes collisions to be missed.
- **Test:** `199_keyword_nested_collision` — `message object { message Bar {} }` (nested → `object_Bar`) and `message object_Bar {}` (top-level → `object_Bar`). Both produce TypeScript name `object_Bar` but Go plugin fails to detect the collision. TS plugin correctly adds `$1` suffix to the second type.
- **Root cause:** Line 1297 in `collectMessageTypeNames`: `g.collectMessageTypeNames(nested, tsName + "_", ...)` uses `tsName` (which is `object$` after keyword escaping) instead of `baseName` (`object`). The collision map has `object$_Bar` and `object_Bar` as different entries, missing the collision. Compare with `generateMessageInterface` at line 2731 which correctly uses `baseName + "_"`.
- **Same bug in `collectEnumTypeNames` call:** Line 1301: `g.collectEnumTypeNames(enum, tsName + "_", ...)` has the same issue for nested enums.
- **Affects:** `export interface`, `class $Type`, `create()`, `internalBinaryRead`, `internalBinaryWrite`, `export const` — all declarations for the colliding type miss the `$1` suffix.

### Run 119 — jsonName tab character not escaped in field descriptor (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` at line ~3798 escapes `\` and `"` in the `jsonName` string value but does NOT escape control characters like `\t`, `\n`, `\r`. When a field has `json_name = "na\tme"`, protoc delivers a literal tab character in the `JsonName` field. The TS plugin escapes it as `\t` in the TypeScript string literal, but the Go plugin outputs the literal tab character.
- **Test:** `200_json_name_tab_escape` — field with `json_name = "na\tme"` containing a tab character.
- **Root cause:** Lines ~3798-3799 only do `strings.ReplaceAll(actualJsonName, "\", "\\")` and `strings.ReplaceAll(escaped, "\"", "\\\"")`. Missing `strings.ReplaceAll(escaped, "\t", "\\t")` and similar for `\n`, `\r`. Compare with `formatCustomOptions()` at lines 960-964 which correctly escapes `\n`, `\r`, `\t`.
- **Affects:** Only the `jsonName: "..."` in field descriptor. The JSDoc `@generated from protobuf field:` annotation outputs the tab literally in both plugins (both agree there).

### Run 120 — DuplexStreamingCall message collision aliases wrong import direction (SUCCESS)
- **Bug found:** When a proto message is named `DuplexStreamingCall` (same as a runtime-rpc streaming call type) and the service actually uses duplex streaming, the Go plugin aliases the PROTO import (`import type { DuplexStreamingCall as DuplexStreamingCall$ } from "./test"`), while the TS plugin aliases the RUNTIME import (`import type { DuplexStreamingCall as DuplexStreamingCall$ } from "@protobuf-ts/runtime-rpc"`).
- **Test:** `201_duplex_call_type_collision` — message named `DuplexStreamingCall` used as input to both a unary and a duplex streaming method.
- **Root cause:** Lines 5519-5528 in `generateClientFile` alias the proto import via `g.importAliases[typeName]` when the proto type name matches a used call type. But the TS plugin aliases the runtime-rpc import instead (keeping proto types unaliased for consistency with the main file). The Go plugin's approach reverses the alias direction.
- **Affects:** All references to the proto message type in the client file use `DuplexStreamingCall$` (wrong, should be unaliased), and the duplex streaming return type uses `DuplexStreamingCall` (runtime type, should be `DuplexStreamingCall$`).
- **Same bug likely affects:** `ServerStreamingCall`, `ClientStreamingCall`, and `UnaryCall` message names with corresponding streaming methods. Only `stackIntercept` is handled differently (lines 5525: `!= "stackIntercept"` special case).

### Run 121 — jsonName newline character not escaped in field descriptor (SUCCESS)
- **Bug found:** `generateFieldDescriptor()` at line ~3798-3800 escapes `\`, `"`, and `\t` in the `jsonName` string value but does NOT escape `\n` (newline). When a field has `json_name = "na\nme"`, protoc delivers a literal newline character in the `JsonName` field. The TS plugin escapes it as `\n` in the TypeScript string literal, but the Go plugin outputs the literal newline character, breaking the line.
- **Test:** `202_json_name_newline` — field with `json_name = "na\nme"` containing a newline character.
- **Root cause:** Lines 3798-3800 escape `\` → `\\`, `"` → `\"`, `\t` → `\t`, but missing `\n` → `\n`. The fix for test 200 (run 119) only added tab escaping but not newline escaping.
- **Affects:** Only the `jsonName: "..."` in field descriptor. The JSDoc annotation outputs the newline literally in both plugins (both agree there).
- **Note:** `\r` (carriage return) is likely also unescaped — same pattern.

### Run 122 — ServerStreamingCall message collision aliases wrong import direction (SUCCESS)
- **Bug found:** When a proto message is named `ServerStreamingCall` (same as a runtime-rpc call type) and the service has server streaming methods (requiring the actual `ServerStreamingCall` call type), the Go plugin aliases the runtime-rpc call type (`ServerStreamingCall$` from `@protobuf-ts/runtime-rpc`), while the TS plugin aliases the proto message import (`ServerStreamingCall$` from `"./test"`). Same fundamental bug as run 120 (DuplexStreamingCall) but for a different call type.
- **Test:** `203_three_way_collision` — message named `ServerStreamingCall` used as input/output to both a server streaming method and a unary method.
- **Root cause:** Lines 5546-5550 in `generateClientFile`: when `actualCallTypeNames[tsName]` is true (proto type name matches a call type), the Go plugin sets `g.callTypeRefs[tsName] = tsName + "$"` (aliasing the call type ref) instead of aliasing the proto import via `g.importAliases`. The TS plugin keeps call types unaliased and aliases the proto import instead.
- **Affects:** Import statements (wrong alias direction), method signatures (call type uses `$` suffix), `stackIntercept` generic type parameters.
- **Note:** Run 120 found this for `DuplexStreamingCall`. This confirms `ServerStreamingCall` has the exact same bug. `ClientStreamingCall` and `UnaryCall` likely also affected but already proven by these two tests.

### Run 123 — Multiple trailing blank lines collapsed to one (SUCCESS)
- **Bug found:** `getLeadingComments()` at line 1140 detects trailing blank lines with `strings.HasSuffix(comment, "\n\n")`, then `strings.TrimRight(comment, " \t\n")` strips ALL trailing whitespace. Later, `hasTrailingBlank` adds exactly TWO `*` separator lines. But the TS plugin's `stripTrailingNewlines` only removes ONE trailing `\n` (line 68-70 of comment-generator.js: `block.slice(0, -1)`), preserving any additional blank lines. With two trailing blank `//` lines, protoc produces `" Comment.\n\n\n"`. TS strips one `\n` → `" Comment.\n\n"`, then adds `\n\n` → four `\n` total → THREE blank `*` lines. Go strips all → adds two `*` lines. One `*` line is lost.
- **Test:** `204_double_trailing_blank` — message with comment ending in two blank `//` lines.
- **Root cause:** `strings.TrimRight(comment, " \t\n")` at line 1143 strips ALL trailing whitespace instead of removing exactly one `\n`. Should preserve N-1 trailing newlines (where N is the count of trailing newlines) and add one more for the separator.
- **Affects:** All JSDoc blocks that use `getLeadingComments` — messages, fields, enums, services, methods. Any comment with 2+ trailing blank lines will lose blank lines.

### Run 124 — Field deprecated=false annotation missing (SUCCESS)
- **Bug found:** `formatFieldOptionsAnnotation()` in main.go checks `field.GetOptions().GetDeprecated()` which returns the boolean VALUE. When `deprecated = false` is explicitly set in the proto file, the Go plugin sees `false` and skips the annotation. But the TS plugin's `getDeclarationString()` uses `isFieldSet(protoOptions, FieldOptionsSchema.field.deprecated)` which checks if the field was EXPLICITLY SET (proto2 presence tracking). When `deprecated = false` is explicitly set, `isFieldSet` returns `true`, and the TS plugin hardcodes `"deprecated = true"` text regardless of actual value.
- **Test:** `205_deprecated_false` — message with field `[deprecated = false]`.
- **Root cause:** Three affected code paths in main.go all check the deprecated VALUE instead of field presence:
  1. `formatFieldOptionsAnnotation()` line ~4673: `field.GetOptions().GetDeprecated()` — annotation in `@generated from protobuf field:` JSDoc
  2. `internalBinaryRead` case comment (uses `formatFieldOptionsAnnotation`)
  3. `internalBinaryWrite` comment (uses `formatFieldOptionsAnnotation`)
- **TS behavior (quirky):** `isFieldSet` + hardcoded `"deprecated = true"` means the annotation ALWAYS shows `deprecated = true` when the deprecated field is explicitly set, even if set to `false`. No `@deprecated` tag is added though (correctly checks actual value). Go plugin correctly omits both annotation and tag.
- **Note:** Same pattern may apply to `packed = false` — but Go already checks `field.GetOptions().Packed != nil` which IS a presence check, so packed is handled correctly. Only `deprecated` uses value-based checking.

### Run 125 — Cross-directory WireType import ordering (SUCCESS)
- **Bug found:** When a message-only file in a subdirectory (e.g., `sub/types.proto`) is compiled together with a service file at root that imports it (e.g., `svc.proto`), the Go plugin moves the `WireType` import to the TOP of the import block (before `BinaryWriteOptions`, `IBinaryWriter`), while the TS plugin keeps it in its normal position (after `IBinaryWriter`).
- **Test:** `206_cross_dir_wiretype_import` — `sub/types.proto` (message-only) imported by `svc.proto` (has service). Recursive test.
- **Root cause:** Go plugin pre-scans all files (lines 130-190) to set `isImportedByService` flag. When true, `wireTypeEarly = true` at line 2046, which emits WireType FIRST (line 2084). The TS plugin generates each file's imports based solely on its own content — it has no concept of cross-file influence on import ordering.
- **Condition:** File has no services AND is imported by a service file in a DIFFERENT directory AND is NOT imported by non-service files in the same directory.
- **Note:** Also modified `protoc-gen-kaja/scripts/test` to add `206_cross_dir_wiretype_import` to the recursive test list (alongside `28_comprehensive`).

### Run 126 — Empty comment line (`//`) leaks blank JSDoc lines (SUCCESS)
- **Bug found:** When a field has a completely empty comment `//` (no space or text after `//`), protoc stores `"\n"` as the leading comment. The Go plugin's `getLeadingComments()` strips trailing whitespace/newlines to get `""` but still returns `("", true)` (has comment). The JSDoc generator then outputs two blank `*` lines. The TS plugin's `stripTrailingNewlines` also strips to `""`, but then `getCommentBlock` checks `commentBlock.length > 0` which is false, so it skips the comment entirely — no blank lines.
- **Test:** `207_empty_comment` — field with `//` (empty comment) and field with `// ` (space-only comment).
- **Root cause:** `getLeadingComments()` at line ~1138 returns `true` whenever `loc.LeadingComments != nil`, regardless of whether the stripped result is empty. The TS plugin effectively treats an empty stripped comment as "no comment". The Go plugin should return `("", false)` when the result after stripping is empty.
- **Difference from `// `:** A `// ` comment produces `" \n"` in protoc → stripped to `""` in Go (same as `//`). But in the TS plugin, `stripTrailingNewlines(" \n")` → `" "` (one space), which has `length > 0` → content IS shown. So `// ` correctly produces blank JSDoc lines in both plugins, but `//` should produce none.
- **Note:** This is a very subtle edge case about the distinction between "comment exists but is empty" vs "no comment". Only `//` triggers it — `// ` (with space) is fine because the space survives `stripTrailingNewlines`.

### Run 127 — Syntax whitespace-only detached comment dropped (SUCCESS)
- **Bug found:** File-level syntax detached comments that are whitespace-only (e.g., `//   ` with spaces but no visible text) are entirely dropped by the Go plugin. The TS plugin correctly outputs them as `//   ` in the file header.
- **Test:** `208_syntax_whitespace_detached` — proto file with `//   ` (whitespace-only) comment before syntax declaration, separated by blank line.
- **Root cause:** Line ~1437 in main.go: `if strings.TrimSpace(detached) != ""` — this skips ALL blocks where TrimSpace returns empty string. But whitespace-only blocks like `"   \n"` should still be output as `//   `. The TS plugin's `out-file.js` processes ALL blocks unconditionally with `.every(block => header.push('//', ...block.split('\n').map(l => '//' + l), '//'))`.
- **Affects:** Both syntax (path [12]) and package (path [2]) detached comment blocks in the file header.
- **Note:** Same issue likely exists in the package detached comment handler at the next code block (~line 1465+). Test only verifies syntax path.

### Run 128 — Multi-service streaming call type import missing (SUCCESS)
- **Bug found:** `generateClientFile()` in main.go only generates streaming call type imports (`ServerStreamingCall`, `ClientStreamingCall`, `DuplexStreamingCall`) for methods belonging to the FIRST service. When a second (or later) service has streaming methods, the required call type import is never emitted.
- **Test:** `209_multi_service` — two services: `SearchService` (unary only) and `ItemService` (unary + server streaming). The `ServerStreamingCall` import is missing from the client file.
- **Root cause:** The service 2..N import loop (lines 5680-5713) only emits proto message type imports (`import type { Item }`, etc.) but never emits call type imports. The first service's import section (lines 5730-5960) correctly handles call types for its own methods, but the second service's streaming methods are never processed for call type imports.
- **Diff:** Expected `import type { ServerStreamingCall } from "@protobuf-ts/runtime-rpc"` between the `ItemService` and `Item` imports. Go plugin omits it entirely.
- **Note:** The `ServerStreamingCall` type is still USED in method signatures (interface + class), just never imported — this would be a TypeScript compilation error.

### Run 129 — Multi-service UnaryCall import missing when first service is all-streaming (SUCCESS)
- **Bug found:** `generateClientFileContent()` in main.go never emits `import type { UnaryCall }` when service 0 has ONLY streaming methods and service 1 has unary methods. The `hasUnaryInService` check at line ~5881 only scans `file.Service[0].Method`. The fallback at line ~6003 checks `!method0IsStreaming` which is false. The service 2..N loop (lines 5695-5718) only emits streaming call type imports, never `UnaryCall`.
- **Test:** `210_multi_service_unary_import` — `StreamService` (server-streaming only) + `QueryService` (unary only). The `UnaryCall` import is missing from the client file.
- **Root cause:** Three code paths all fail to emit `UnaryCall` for service 2's unary methods:
  1. Lines 5881-5891: `hasUnaryInService` only checks service 0's methods → false
  2. Lines 5695-5718: service 2..N loop only emits streaming call types (if streaming)
  3. Lines 6002-6006: `method0IsStreaming=true` → skipped
- **Diff:** Expected `import type { UnaryCall } from "@protobuf-ts/runtime-rpc"` after `QueryService` import. Go plugin omits it entirely.
- **Severity:** Produces TypeScript that fails to compile — `UnaryCall` type is used in method signatures but never imported.

### Ideas for future runs
- `ScalarType` collision — message named `ScalarType` in file with well-known wrapper types. Go plugin doesn't alias `import { ScalarType }`.
- `LongType` collision — same pattern.
- Multi-service: service 2+ with client-streaming methods — `ClientStreamingCall` import likely also missing.
- Multi-service: service 2+ with duplex-streaming methods — `DuplexStreamingCall` import likely also missing.
- Service method trailing comment multiline — same bug pattern as run 81.
- Enum detached comment nospace formatting — `// %s` adds space for no-space comments.
- Custom option with oneof field inside message-typed option value.
- Deeply nested messages (5+ levels) — type name construction.
- Enum nested inside lowercase-named parent from different package.

### Run 130 — Extend-only file skips WKT generation (SUCCESS)
- **Bug found:** `generate()` in main.go (line ~216) guards WKT file generation with `if len(generatedFiles) > 0`. When the input proto file has ONLY `extend` blocks (no messages, enums, or services), `generateFile()` returns empty content, so `generatedFiles` remains empty. The WKT generation is then skipped entirely, even though the import (`google/protobuf/descriptor.proto`) should still produce output.
- **Test:** `211_extend_only` — proto2 file with only `extend google.protobuf.MessageOptions { optional string my_option = 50001; }` and import of `descriptor.proto`.
- **Root cause:** Line ~216 `if len(generatedFiles) > 0` should not gate WKT generation. The TS plugin always generates files for imported WKTs regardless of whether the main file produces output. The Go plugin should check if any dependency needs generation regardless of `generatedFiles` count.
- **Diff:** Expected `google/protobuf/descriptor.ts` (~15K lines) exists. Actual: nothing generated at all.

### Run 131 — Import public missing transitive import (SUCCESS)
- **Bug found:** `generateImports()` in main.go has ZERO handling for `publicDependency`. When `consumer.proto` imports `re_export.proto` which has `import public "base.proto"`, the TS plugin generates `import { Base } from "./base"` in `consumer.ts` because `Base` is transitively available through the public import chain. The Go plugin only looks at direct dependencies, so it never generates the import for `Base`.
- **Test:** `212_import_public` — three files: `base.proto` (defines `Base`), `re_export.proto` (has `import public "base.proto"` and defines `Wrapper` using `Base`), `consumer.proto` (imports `re_export.proto` and uses both `Base` and `Wrapper`).
- **Root cause:** The Go plugin's import resolution scans `g.file.Dependency` (direct imports) to find where types are defined, but never follows `g.file.PublicDependency` to discover types that are transitively available through `import public` chains. The `publicDependency` field in the file descriptor lists indices into `dependency` that are public imports.

### Ideas for future runs
- `import public` chains deeper than 1 level — A imports B (public) which imports C (public).
- `import public` with enum types — same bug likely applies.
- `ScalarType` collision — message named `ScalarType` in file with well-known wrapper types.
- Deeply nested messages (5+ levels) — type name construction.
- Enum nested inside lowercase-named parent from different package.
- Proto2 required group vs optional group handling.

### Run 132 — Enum prefix missing for import public enums (SUCCESS)
- **Bug found:** `findEnumType()` in main.go (line ~3675) searches current file enums and `g.file.Dependency` (direct dependencies) for the enum descriptor to detect shared prefix. But enums available through `import public` chains are NOT in `g.file.Dependency` — they're in a transitively imported file. So `findEnumType` returns nil, and `detectEnumPrefix` is never called, dropping the enum prefix from the field descriptor.
- **Test:** `213_import_public_enum_prefix` — `base.proto` defines `Status` enum with `STATUS_` prefix, `re_export.proto` has `import public "base.proto"`, `consumer.proto` imports `re_export.proto` and uses `Status` in a field.
- **Root cause:** Line 3700-3726 in `findEnumType` iterates `g.file.Dependency` to scan dependency files for enums, but doesn't call `collectTransitivePublicDeps` to also check transitively public-imported files. Compare with import resolution at line 1748 which correctly calls `collectTransitivePublicDeps(g.file)` to include public imports.
- **Diff:** Expected `T: () => ["test.Status", Status, "STATUS_"]`, got `T: () => ["test.Status", Status]`. The import statement for `Status` is correct (handled by import resolution), but the enum prefix metadata is wrong.
- **Note:** Same bug affects map fields with enum values from public imports (line 3812-3817 calls `findEnumType` too).

### Ideas for future runs
- `findMessageType` may have same `import public` bug — message field descriptor T parameter could be affected.
- Multi-service: service 2+ with client-streaming methods — `ClientStreamingCall` import likely also missing (same as runs 128-129).
- Service method trailing comment multiline.
- Custom option with oneof inside message value.
- Deeply nested messages (5+ levels) with underscores in names — type name construction edge cases.

### Run 133 — Empty service + non-empty service client import ordering (SUCCESS)
- **Bug found:** When a file has an empty service (no methods) alongside a service with methods, the Go plugin orders imports differently in the `.client.ts` file. Specifically, `stackIntercept`, `RpcOptions`, and the method I/O type (`Empty`) are placed after the empty service's import instead of before it.
- **Test:** `214_empty_service` — file with `EmptyService` (no methods) + `SmallService` (one unary method using `google.protobuf.Empty`).
- **Root cause:** The Go plugin's client file import ordering logic doesn't account for services with zero methods. The TS plugin processes all method-related imports (stackIntercept, RpcOptions, I/O types, call types) BEFORE the service imports for services without methods, while the Go plugin interleaves them differently.
- **Diff:** TS orders: SmallService, stackIntercept, Empty, UnaryCall, RpcOptions, RpcTransport, ServiceInfo, EmptyService. Go orders: SmallService, UnaryCall, Empty, RpcTransport, ServiceInfo, EmptyService, stackIntercept, RpcOptions.
- **Note:** Only affects `.client.ts` — the main `.ts` file matches. Bug is in the client file import generation at ~line 5594+.

### Run 134 — Multi-service ClientStreamingCall import ordering (SUCCESS)
- **Bug found:** When a second service has a client-streaming method, the Go plugin places the `ClientStreamingCall` import too early — immediately after the service import, before the message type imports. The TS plugin places it after the message type imports for that service.
- **Test:** `215_multi_service_client_stream` — `PingService` (unary only) + `LogService` (client-streaming `StreamLogs(stream LogEntry) returns (Summary)`).
- **Root cause:** Same import ordering bug pattern as runs 128-129, 133. The Go plugin's client file import ordering at ~line 5594+ doesn't match the TS plugin's import ordering for streaming call types.
- **Diff:** Expected: LogService, Summary, LogEntry, ClientStreamingCall, ... Actual: LogService, ClientStreamingCall, Summary, LogEntry, ...
- **Note:** Same bug pattern likely applies to `DuplexStreamingCall` for service 2+ (not yet tested).

### Run 135 — google.type.Date missing toJsDate/fromJsDate methods (SUCCESS)
- **Bug found:** The Go plugin does NOT implement `google.type.*` custom methods at all. The TS plugin has a `GoogleTypes` extension class (`google-types.js`) that adds custom helper methods for `google.type.Color` (toHex/fromHex), `google.type.Date` (toJsDate/fromJsDate), `google.type.DateTime` (now/toJsDate/fromJsDate), and `google.type.TimeOfDay` (fromJsDate). The Go plugin only handles `google.protobuf.*` WKT types.
- **Test:** `216_google_type_date` — proto file with `package google.type; message Date { int32 year; int32 month; int32 day; }`.
- **Root cause:** The Go plugin's `generateMessageTypeClass()` (around line 4056) only checks for `google.protobuf.*` WKT types (`generateTimestampMethods`, `generateDurationMethods`, `generateFieldMaskMethods`, etc.) but has no equivalent of the TS plugin's `GoogleTypes.make()` which handles `google.type.*` types.
- **Diff:** Expected output has `toJsDate()` and `fromJsDate()` methods in the `Date$Type` class. Actual output is missing them entirely.
- **Note:** Same bug applies to `google.type.Color` (toHex/fromHex), `google.type.DateTime` (now/toJsDate/fromJsDate), and `google.type.TimeOfDay` (fromJsDate). Each could be a separate test.

### Run 136 — google.type.Color method formatting differences (SUCCESS)
- **Bug found:** The Go plugin's `generateGoogleTypeColorMethods()` hand-writes the `toHex()` and `fromHex()` methods as plain text. The TS plugin passes method source through `typescriptMethodFromText()` which parses it into a TypeScript AST and re-prints it. The AST printer reformats the code differently:
  1. **Single quotes → double quotes**: Go outputs `'#'`, `'0'`, `''`; TS printer converts to `"#"`, `"0"`, `""`.
  2. **Multi-line → collapsed**: Go puts each `red/green/blue` property on its own line; TS printer collapses short object literals to one line.
  3. **Inline comments dropped**: Go includes `// #RGB`, `// #RRGGBB`, `// #RGBA`, `// #RRGGBBAA` inside `if` blocks; TS AST parsing strips these comments entirely.
- **Test:** `217_google_type_color` — `package google.type; message Color { float red; float green; float blue; FloatValue alpha; }`.
- **Root cause:** The Go plugin at lines ~7537-7644 manually formats output, but the TS plugin's `google-types.js` uses template strings that go through TypeScript's AST printer (`typescriptMethodFromText`), which normalizes quote style, collapses short expressions to single lines, and strips inline comments.
- **Note:** Same formatting bugs likely affect `google.type.DateTime` and `google.type.TimeOfDay` methods too. The `google.type.Date` methods (test 216) happen to be simple enough that the formatting matches.

### Run 137 — google.type.DateTime fromJsDate formatting and missing PbLong import (SUCCESS)
- **Bug found:** Two bugs in `generateGoogleTypeDateTimeMethods()`:
  1. **Missing `PbLong` import**: Go plugin uses `PbLong.from(...)` in both `toJsDate()` and `fromJsDate()` methods but never adds `PbLong` to the imports. The TS plugin's `google-types.js` calls `this.imports.name(source, 'PbLong', ...)` which adds the import.
  2. **`fromJsDate` formatting**: Go plugin puts the entire return object on one line (`year: date.getFullYear(), month: date.getMonth() + 1, ...`). The TS AST printer formats each property on its own line with proper indentation.
- **Test:** `218_google_type_datetime` — `package google.type; message DateTime { ... }` with Duration import for utc_offset oneof.
- **Root cause:** (1) Line ~7628 in `generateGoogleTypeDateTimeMethods` never calls `g.addRuntimeImport("PbLong")`. (2) Lines ~7694-7710 manually format the return statement as nested `g.p()` calls at specific indent levels, but the resulting output doesn't match the TypeScript AST printer's formatting of the same template from `google-types.js`.

### Run 138 — google.type.TimeOfDay fromJsDate object collapsed to single line (SUCCESS)
- **Bug found:** `generateGoogleTypeTimeOfDayMethods()` in main.go puts each property of the return object on its own line (`hours: date.getHours(),\nminutes: ...`). The TS plugin's `google-types.js` passes the template through `typescriptMethodFromText()` which parses it as TypeScript AST and re-prints it. The TS AST printer collapses the 4-property object literal to a single line because it's short enough.
- **Test:** `219_google_type_timeofday` — `package google.type; message TimeOfDay { int32 hours; int32 minutes; int32 seconds; int32 nanos; }`.
- **Root cause:** Lines ~7728-7731 in `generateGoogleTypeTimeOfDayMethods` output each property on its own line with separate `g.p()` calls. The TS printer's line-width heuristic determines the object is short enough to fit on one line: `hours: date.getHours(), minutes: date.getMinutes(), seconds: date.getSeconds(), nanos: date.getMilliseconds() * 1000,`.
- **Diff:** Expected one line `hours: date.getHours(), minutes: date.getMinutes(), seconds: date.getSeconds(), nanos: date.getMilliseconds() * 1000,`. Got four separate lines.
- **Note:** Same formatting pattern as runs 136 (Color) and 137 (DateTime) — the TS AST printer collapses short object literals. The Date test (216) passes because its object has only 3 short properties which happen to match the multi-line format.

### Run 139 — Oneof group field not skipped in interface union type (SUCCESS)
- **Bug found:** `generateOneofField()` in main.go iterates through ALL oneof member fields including GROUP type fields. The TS plugin's `buildFieldInfos()` skips GROUP fields entirely (`if (fd.proto.type == GROUP) { continue; }`), so group fields never appear in the interpreter's field info list and are never included in the oneof union type. The Go plugin includes them, adding a spurious `{ oneofKind: "mygroup"; mygroup: any; }` case.
- **Test:** `220_oneof_group_field` — proto2 message with a oneof containing string, int32, and a group field.
- **Root cause:** `generateOneofField()` at line ~3053 receives `fields` (all fields belonging to the oneof) but never checks `field.GetType() == TYPE_GROUP` to skip group fields. The field descriptor constructor and binary read/write methods already skip GROUP fields (they check `TYPE_GROUP` and continue), but the oneof interface union type generation does not.
- **Diff:** Expected: oneof union has `text | number | undefined`. Got: `text | number | mygroup | undefined`.

### Run 140 — Map entry name collision breaks map detection (SUCCESS)
- **Bug found:** `findMessageTypeInMessage()` at line 3783 uses `strings.HasSuffix(typeName, fullName)` to match types, which is too loose. When searching for `testpkg.Config.SettingsEntry` (a synthetic map entry message), the function finds a top-level message named `Entry` because `HasSuffix("testpkg.Config.SettingsEntry", "Entry")` is TRUE. Since `Entry` is NOT a map entry type, `GetMapEntry()` returns false, and the map field is incorrectly treated as a regular `repeated` message field.
- **Test:** `221_map_entry_name_collision` — message `Entry` (whose name is a suffix of `SettingsEntry`) alongside `Config` with `map<string, string> settings` and `map<int32, Entry> entries`.
- **Root cause:** `findMessageTypeInMessage` at line 3783 matches `Entry` when looking for `Config.SettingsEntry` because `HasSuffix` doesn't check for a proper boundary (e.g., `.` prefix). The function returns the WRONG message descriptor, and all downstream code (interface generation, field descriptors, binary read/write) falls back to treating the map field as `repeated Config_SettingsEntry`.
- **Massive diff:** Interface (`{}` vs `[]`), field descriptors (`kind: "map"` vs `kind: "message"`), create() defaults (`{}` vs `[]`), binary read (map readers vs push), binary write (map iteration vs message array), plus spurious `Config_SettingsEntry` and `Config_EntriesEntry` type declarations in Go output.

### Ideas for future runs
- The same `HasSuffix` bug may also cause incorrect type resolution for non-map fields when a shorter-named type shadows a nested type.
- Proto2 extension declarations as standalone constants — VERIFIED: TS plugin does NOT generate extension objects. No diff.
- Deeply nested messages (5+ levels) with underscores in names.
- Service method named `constructor` or `name` — TS escapes these, does Go?
- `ScalarType` collision — message named `ScalarType`.
- `LongType` collision — message named `LongType`.
- Group field in non-oneof context — check if regular field JSDoc also spuriously includes group field info.

### Run 141 — EnumValue falsely treated as wrapper type (SUCCESS)
- **Bug found:** `isWrapper` check at line 4071 in `generateMessageTypeClass()` uses `strings.HasSuffix(fullName, "Value") && fullName != "Value" && fullName != "ListValue"` to detect wrapper types (Int32Value, StringValue, etc.). But this also matches ANY message in `google.protobuf` package whose name ends with "Value", including `EnumValue` from `google/protobuf/type.proto`. The Go plugin then generates spurious `internalJsonWrite` and `internalJsonRead` wrapper methods plus unnecessary `ScalarType`, `LongType`, `JsonValue`, `JsonReadOptions`, `JsonWriteOptions` imports.
- **Test:** `222_enum_value_wrapper` — `package google.protobuf` with a message `EnumValue { string name; int32 number; }`.
- **Root cause:** Line 4071 should explicitly check for known wrapper type names (`Int32Value`, `UInt32Value`, `Int64Value`, `UInt64Value`, `FloatValue`, `DoubleValue`, `BoolValue`, `StringValue`, `BytesValue`) instead of using `HasSuffix(fullName, "Value")`. Same issue exists in the import generation at line ~2003 which also uses `HasSuffix(name, "Value")`.
- **Also found:** Transitive WKT dependency generation is broken — when `type.proto` imports `any.proto`, the Go plugin doesn't generate `any.ts`. But this is a separate bug from the wrapper false positive. Save for future run.

### Run 142 — Wrapper types unconditionally import ScalarType/LongType (SUCCESS)
- **Bug found:** `generateImports()` in main.go unconditionally imports `ScalarType` and `LongType` from `@protobuf-ts/runtime` whenever `isWrapper` is true (i.e., the file contains any wrapper type). But these imports are only needed for `Int64Value` and `UInt64Value` (which use `ScalarType.INT64`/`ScalarType.UINT64` and `LongType.STRING`). For `DoubleValue`, `FloatValue`, `Int32Value`, `UInt32Value`, `BoolValue`, `StringValue`, and `BytesValue`, the imports are spurious — the generated code uses numeric literals, not `ScalarType` enum references.
- **Test:** `223_wrapper_float_double_swap` — `package google.protobuf` with only `DoubleValue` and `FloatValue` messages.
- **Root cause:** The import generation adds `ScalarType` and `LongType` based on blanket `isWrapper` check without verifying which specific wrapper types are present. The TS plugin only imports what's actually used in the generated code.
- **Diff:** Go output has two extra import lines (`ScalarType`, `LongType`) that don't appear in TS output.

### Run 143 — Three-way type collision alias suffix bug (SUCCESS)
- **Bug found:** When three different packages each define a type with the same name (e.g., `Item`), the Go plugin uses repeated `$` characters for aliases (`Item`, `Item$`, `Item$$`), while the TS plugin uses numeric suffixes (`Item`, `Item$`, `Item$2`). The third and subsequent collisions produce different alias names.
- **Test:** `224_three_way_type_collision` — three packages (a, b, c) each with `message Item`, imported by a main file using all three.
- **Root cause:** The Go plugin's `createLocalTypeName` (or equivalent alias generation) appends `$` for each collision instead of using `$N` numeric suffixes. TS plugin's `createLocalTypeName` uses `name + '$' + suffix` where suffix is the collision index (empty for first collision, then 2, 3, ...).
- **Affects:** Import alias (`as Item$$` vs `as Item$2`), interface property types, field descriptors `T: ()`, `internalBinaryRead`, `internalBinaryWrite` — all references to the third+ collision.

### Run 144 — WKT transitive import not generated (SUCCESS)
- **Bug found:** When a proto file imports `google/protobuf/type.proto`, the TS plugin generates `any.ts` as a transitive dependency (because `type.proto` imports `any.proto`). The Go plugin only generates files for direct imports but not their transitive dependencies.
- **Test:** `225_wkt_transitive_import` — imports `google/protobuf/type.proto` which transitively depends on `google/protobuf/any.proto`.
- **Root cause:** The Go plugin iterates `file.Dependency` to decide which imported files to generate, but doesn't recursively follow the dependency chain. The TS plugin's `DescriptorRegistry` tracks all transitively referenced types and generates files for them.

### Run 145 — ScalarType import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `ScalarType` collisions. When a file in `google.protobuf` package defines both `Int64Value` (a wrapper type that needs `import { ScalarType }` from runtime) AND a message named `ScalarType`, the Go plugin imports `ScalarType` without aliasing, causing a name collision with the local `export interface ScalarType`. The TS plugin correctly aliases it as `import { ScalarType as ScalarType$ }` and uses `ScalarType$.INT64` in the wrapper methods.
- **Test:** `227_scalar_type_collision` — `google.protobuf` package with `Int64Value` and `ScalarType` messages.
- **Root cause:** `collectLocalTypeNames()` at lines 2310-2350 checks for collisions with WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial — but NOT ScalarType or LongType. The wrapper import code at line 2130 always uses `import { ScalarType }` without checking for alias.
- **Three sub-bugs:** (1) No `ScalarType` collision detection, (2) Import position wrong (before other imports instead of after `reflectionMergePartial`), (3) Uses `ScalarType.INT64` instead of `ScalarType$.INT64` in `internalJsonWrite`/`internalJsonRead`.

### Run 146 — LongType runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `LongType` collisions. When a file in `google.protobuf` package defines both `UInt64Value` (a wrapper type that needs `import { LongType }` from runtime) AND a message named `LongType`, the Go plugin imports `LongType` without aliasing, causing a name collision with the local `export interface LongType`. The TS plugin correctly aliases it as `import { LongType as LongType$ }` and uses `LongType$.STRING` in wrapper methods.
- **Test:** `228_long_type_collision` — `google.protobuf` package with `UInt64Value` and `LongType` messages.
- **Root cause:** `collectLocalTypeNames()` at lines 2318-2361 checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType — but NOT `LongType`. Lines 2133/2209 import `LongType` without aliasing. Line 7415 uses `LongType.STRING` instead of `LongType$.STRING`.
- **Three sub-bugs:** (1) No `LongType` collision detection, (2) Import position wrong (at top before `BinaryWriteOptions` instead of after `reflectionMergePartial`), (3) Uses `LongType.STRING` instead of `LongType$.STRING` in `internalJsonRead`.

### Ideas for future runs
- Four-way collision — `Item$3` vs `Item$$$`.
- `NullValue` from `struct.proto` — another message ending with "Value" in google.protobuf.
- Deeply nested messages (5+ levels) with underscores in names.
- `JsonValue`/`JsonReadOptions`/`JsonWriteOptions` collision — wrapper types import these as `import type`, Go doesn't alias.

### Run 147 — PbLong runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `PbLong` collisions. When a file in `google.protobuf` package defines both `Timestamp` (which needs `import { PbLong }` from runtime for `now()`, `toDate()`, `fromDate()` methods) AND a message named `PbLong`, the Go plugin imports `PbLong` without aliasing, causing a name collision with the local `export interface PbLong`. The TS plugin correctly aliases it as `import { PbLong as PbLong$ }` and uses `PbLong$.from(...)` in Timestamp methods.
- **Test:** `229_pblong_collision` — `google.protobuf` package with `Timestamp` and `PbLong` messages.
- **Root cause:** `collectLocalTypeNames()` checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType, LongType — but NOT `PbLong`. Lines 2167/2176/2181 import `PbLong` without aliasing. Lines 6922/6934/6946/6959/7018/7038 use `PbLong.from(...)` instead of `PbLong$.from(...)`.
- **Same pattern as runs 145-146:** Another runtime import name missing from collision detection.

### Run 148 — typeofJsonValue runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `typeofJsonValue` collisions. When a file in `google.protobuf` package defines both `Timestamp` (which needs `import { typeofJsonValue }` from runtime for JSON parsing error messages) AND a message named `typeofJsonValue`, the Go plugin imports `typeofJsonValue` without aliasing, causing a name collision with the local `export interface typeofJsonValue`. The TS plugin correctly aliases it as `import { typeofJsonValue as typeofJsonValue$ }`.
- **Test:** `230_typeof_json_value_collision` — `google.protobuf` package with `Timestamp` and `typeofJsonValue` messages.
- **Root cause:** `collectLocalTypeNames()` checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType, LongType, PbLong — but NOT `typeofJsonValue`. Lines 2165/2174/2187/7010/7087 etc. use hardcoded `typeofJsonValue` without aliasing.
- **Same pattern as runs 145-147:** Another runtime import name missing from collision detection.
- **Note:** Same bug applies to `lowerCamelCase` (FieldMask), `isJsonObject` (Struct/Any), `jsonWriteOptions` (Any) — all lowercase runtime imports without collision detection.

### Run 149 — lowerCamelCase runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `lowerCamelCase` collisions. When a file in `google.protobuf` package defines both `FieldMask` (which needs `import { lowerCamelCase }` from runtime for JSON encoding) AND a message named `lowerCamelCase`, the Go plugin imports `lowerCamelCase` without aliasing, causing a name collision with the local `export interface lowerCamelCase`. The TS plugin correctly aliases it as `import { lowerCamelCase as lowerCamelCase$ }` and uses `lowerCamelCase$(p)` in FieldMask methods.
- **Test:** `231_lower_camel_case_collision` — `google.protobuf` package with `FieldMask` and `lowerCamelCase` messages.
- **Root cause:** `collectLocalTypeNames()` at lines 2323-2378 checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType, LongType, PbLong, typeofJsonValue — but NOT `lowerCamelCase`. Line 2191 imports `lowerCamelCase` without aliasing. Line 7145 uses `lowerCamelCase(p)` instead of `lowerCamelCase$(p)`.
- **Same pattern as runs 145-148:** Another runtime import name missing from collision detection.

### Run 150 — isJsonObject runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `isJsonObject` collisions. When a file in `google.protobuf` package defines both `Struct` (which needs `import { isJsonObject }` from runtime for JSON parsing) AND a message named `isJsonObject`, the Go plugin imports `isJsonObject` without aliasing, causing a name collision with the local `export interface isJsonObject`. The TS plugin correctly aliases it as `import { isJsonObject as isJsonObject$ }` and uses `isJsonObject$(json)` in Struct methods.
- **Test:** `232_is_json_object_collision` — `google.protobuf` package with `Struct` (full WKT) and `isJsonObject` messages.
- **Root cause:** `collectLocalTypeNames()` at lines 2326-2384 checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType, LongType, PbLong, typeofJsonValue, lowerCamelCase — but NOT `isJsonObject`. Lines 2200/2221 import `isJsonObject` hardcoded. Lines 7224/7558/7570 use `isJsonObject(json)` instead of `isJsonObject$(json)`.
- **Same pattern as runs 145-149:** Another runtime import name missing from collision detection.

### Run 151 — jsonWriteOptions runtime import collision not aliased (SUCCESS)
- **Bug found:** `collectLocalTypeNames()` in main.go does NOT detect `jsonWriteOptions` collisions. When a file in `google.protobuf` package defines both `Any` (which needs `import { jsonWriteOptions }` from runtime for JSON serialization) AND a message named `jsonWriteOptions`, the Go plugin imports `jsonWriteOptions` without aliasing, causing a name collision with the local `export interface jsonWriteOptions`. The TS plugin correctly aliases it as `import { jsonWriteOptions as jsonWriteOptions$ }` and uses `jsonWriteOptions$(options)` in the Any `internalJsonWrite` method.
- **Test:** `233_json_write_options_collision` — `google.protobuf` package with `Any` and `jsonWriteOptions` messages.
- **Root cause:** `collectLocalTypeNames()` at lines 2326-2390 checks WireType, MessageType, ServiceType, UnknownFieldHandler, PartialMessage, BinaryReadOptions, BinaryWriteOptions, IBinaryReader, IBinaryWriter, reflectionMergePartial, ScalarType, LongType, PbLong, typeofJsonValue, lowerCamelCase, isJsonObject — but NOT `jsonWriteOptions`. Line 2226 imports `jsonWriteOptions` hardcoded. Line 7563 uses `jsonWriteOptions(options)` instead of `jsonWriteOptions$(options)`.
- **Same pattern as runs 145-150:** Another runtime import name missing from collision detection.

### Run 152 — JsonValue type import collision not aliased (SUCCESS)
- **Bug found:** When a file in `google.protobuf` package defines both `Timestamp` (WKT that needs `import type { JsonValue }` from runtime) AND a message named `JsonValue`, the Go plugin imports `JsonValue` without aliasing. The TS plugin correctly aliases it as `import type { JsonValue as JsonValue$ }` and uses `JsonValue$` as return/parameter type in `internalJsonWrite`/`internalJsonRead`.
- **Test:** `234_json_value_type_collision` — `google.protobuf` package with `Timestamp` and `JsonValue` messages.
- **Root cause:** The Go plugin has NO collision detection for TYPE imports (`import type { ... }`). All previous collision detection (runs 145-151) was for VALUE imports (`import { ... }`). The `JsonValue` type import at lines 2174/2183/2196/2206/2214 is always hardcoded as `JsonValue` without checking if a local type with that name exists.
- **Three sub-bugs:** (1) No `JsonValue` collision detection in `collectLocalTypeNames`, (2) Import line always `import type { JsonValue }` without aliasing, (3) Uses `JsonValue` instead of `JsonValue$` as return type of `internalJsonWrite` and parameter type of `internalJsonRead`.
- **Same pattern applies to:** `JsonReadOptions`, `JsonWriteOptions`, `JsonObject`, `IMessageType` — all are TYPE imports without collision detection.

### Ideas for future runs
- `JsonReadOptions` type import collision — same pattern as run 152.
- `JsonWriteOptions` type import collision — same pattern as run 152.
- `IMessageType` type import collision — Any WKT imports this as `import type`, Go doesn't alias.
- `JsonObject` type import collision — imported as type for Struct WKT.
- Four-way collision — `Item$3` vs `Item$$$`.
- `NullValue` from `struct.proto` — another message ending with "Value" in google.protobuf.
