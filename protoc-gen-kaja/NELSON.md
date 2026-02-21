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
- **WKT-typed custom field options** — When a custom field option uses a Well-Known Type (e.g. `google.protobuf.Duration`, `google.protobuf.Timestamp`) as its message type, the Go plugin drops the option entirely. Root cause: `opts.ProtoReflect().GetUnknown()` returns empty bytes for extensions whose value type is a WKT, likely because the Go protobuf library resolves/absorbs WKT message payloads during deserialization. Non-WKT custom message options with identical structure work fine. Tested in `239_wkt_custom_option`.

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
- WKT custom options on messages/services/methods (not just fields)
- Custom options with `google.protobuf.Any`, `google.protobuf.Struct`, `google.protobuf.Value` as the option type
- Custom options with `google.protobuf.FieldMask`, `google.protobuf.Empty` as option types
- Custom oneof-level options (`OneofOptions` extensions)
- Extension field info generation for proto2 `extend` blocks
