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

### Ideas for future runs
- Proto2 with `group` fields — verify nested message codegen matches.
- `oneof` containing a `bytes` field — check write condition.
- Map with `int64` keys + `long_type_string` — check if `parseInt` vs raw `k` is correct.
- Proto file with only enums and no messages — import generation edge case.
- Deeply nested type collision suffix handling in imports.
- `deprecated` option on oneof fields.
- Large field numbers (> 2^28) in binary read comments.
- `getMapValueWriter` — check if fixed-width value types also have wrong wire types (similar to key bug).
- Check `internalBinaryRead` for map entries with fixed-width keys — does reader use correct methods?