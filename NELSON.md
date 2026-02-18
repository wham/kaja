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

### Ideas for future runs
- Proto2 with `group` fields — verify nested message codegen matches.
- `oneof` containing a `bytes` field — check write condition.
- Proto file with only enums and no messages — import generation edge case.
- Deeply nested type collision suffix handling in imports.
- Large field numbers (> 2^28) in binary read comments.
- Enum oneof fields with custom json_name — same bug likely affects enum fields in oneof too (the "message, enum, or map" branch does include `jsonNameField` but check ordering).
- `opt: true` / `repeat` on oneof scalar fields — these are also missing from the scalar-oneof branch format string.
- Oneof field JSDoc missing `[default = ...]` annotation for proto2 oneof members (regular field has it, oneof doesn't).
- Nested messages with underscored names AND map fields — double mangling of `_` to `.` in error strings (variant of run 9 bug).
- `opt: true` / `repeat` on oneof scalar fields — these are also missing from the scalar-oneof branch format string.
- Deep nesting (3+ levels) with oneofs — would amplify the nested oneof path bug even more.