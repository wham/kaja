## Task

You are porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. The Go implementation must have the exactly same output.

## Steps

1. Analyze what's already in place
2. Do additional web research how to achieve the task. Clone the TS plugin source code and inspect.
3. Update [Plan](./PROMPT.md#plan) if needed. Be comfortable trying bigger architecture changes. Document. PROMPT.md is your memory. Keep it up to date.
3. Implement a piece of it. Spend substantial effort here.
4. Run the tests
5. Capture important learnings in [Notes](./PROMPT.md/#notes). Stuff that will make the task easier for you in the future. For example how to run the tests. How the code is structured. Don't add things that would soften the requirements - i.e. "we are close, this is cosmetic". If you see them, remove them.
6. Commit the changes. One line message with summary what was done.
7. If all tests passing, put line "DONE" at the end of PROMPT.md. No exceptions. ALL TESTS MUST PASS.

## Plan

- [x] Build a test harness that compares `protoc-gen-ts` and `protoc-gen-kaja` on set of sample projects
- [x] Implement core message/enum/service generation
- [x] Fix proto2 optional field serialization (check !== undefined)
- [x] Fix client file import ordering (types from same file maintain order)
- [x] Fix grpcbin trailing comment handling (SOLVED via SourceCodeInfo.TrailingComments)
- [x] Fix WireType import positioning in batch generation for lib files (SOLVED)
- [x] Fix client file import ordering for streaming methods (interleave vs group strategy)
- [x] Fix cross-import-path type ordering (deferred input emission)
- [ ] Fix field descriptor ordering (must be in field number order, not grouped)
- [ ] Fix proto3 optional field handling (should be simple optional, not oneofs)
- [ ] Fix oneof names in metadata (use proto snake_case, not camelCase)
- [ ] Fix jsonName handling (show in comments and metadata when custom)
- [ ] Fix leading underscore camelCase conversion (_private → Private)

## Notes

### Trailing Comments (SOLVED)
Proto field trailing comments (comments on the same line or after a field declaration) are extracted from `SourceCodeInfo.TrailingComments`. These are appended as ` // <comment>` on the same line as the field in the TypeScript interface. Multiline trailing comments are collapsed to a single line with spaces.

Implementation: `getTrailingComments()` function extracts the comment, and it's appended to field declarations in `generateField()`.

### Proto2 Optional Fields
Proto2 `optional` fields and proto3 explicit optional fields (`optional` keyword in proto3) must check `!== undefined` before serialization, not just compare against default values. This is implemented in `getWriteCondition()`.

### Import Ordering Strategy (SOLVED)
Client file import ordering uses two strategies depending on method types:

**Interleave Strategy** (when first non-method-0 method is streaming):
1. For each streaming method N→1: emit message types, then emit its call type (DuplexStreamingCall, etc.)
2. Then emit non-streaming method types
3. Then stackIntercept
4. Then method 0 types

**Group Strategy** (when first non-method-0 method is non-streaming):
1. Emit all non-streaming method types N→1
2. Emit all streaming call types together (Duplex, Client, Server)
3. Emit all streaming message types
4. Then stackIntercept
5. Then method 0 types

**Cross-Import-Path Type Ordering:**
When collecting non-streaming types from methods N→1:
- Emit output type first
- If input type is from same import path as output OR input == output: emit immediately
- If input type is from different import path: defer it
- When we encounter an output type from the deferred input's path: emit the deferred input immediately after
- Any remaining deferred inputs are appended at the end

This ensures types from different import paths are grouped together while maintaining method ordering within each path group.

### Format String Linter Fix
Go's linter requires format strings in printf-style functions to be constants. When passing dynamic strings to `pNoIndent()`, use `"%s"` format with the string as an argument instead of passing the string directly as the format parameter.

### TypeScript Keyword Escaping (SOLVED)
Message, enum, and service names that collide with TypeScript reserved keywords or type names get a `$` suffix in the generated TypeScript code. The escaping applies to:
- Reserved keywords: `break`, `case`, `const`, `let`, `class`, `interface`, etc.
- Reserved type names: `object`, `Uint8Array`, `Array`, `String`, `Number`, etc.

Important: 
- Only the TypeScript interface/enum/class names get the `$` suffix
- The proto name in `@generated` comments and `MessageType` constructor remains unchanged
- Both escaped and proto names must be tracked separately through nested types

### Enum Prefix Stripping (SOLVED)
Enum values have their common prefix stripped based on the enum name:
1. Convert enum name to UPPER_SNAKE_CASE (e.g., "MyEnum" → "MY_ENUM_", "const_enum" → "CONST_ENUM_")
2. Check if all values start with this prefix
3. Check if stripped names are valid (start with uppercase letter)
4. If both conditions pass, strip the prefix from enum value names

Example: enum `MyEnum` with values `MY_ENUM_VALUE1`, `MY_ENUM_VALUE2` → becomes `VALUE1`, `VALUE2`
Counter-example: enum `const_enum` with values `CONST_UNKNOWN`, `CONST_VALUE` → keeps original names (prefix is "CONST_", not "CONST_ENUM_")

### Test Execution
Run tests: `cd protoc-gen-kaja && ./scripts/test`
Build: Automatically done by test script via `go build`

### Oneof Field Naming and Ordering
Oneof fields in TypeScript interfaces use camelCase for the oneof name (e.g., `dataFormat` not `data_format`), but the `@generated` comment uses the original proto name. Fields and oneofs appear in field number order in the interface, not grouped separately.

Implementation:
- Interface generation loops through fields in field number order
- When encountering first field of a oneof, generates entire oneof group
- Uses `toCamelCase()` helper to convert oneof names
- Tracks generated oneofs to avoid duplication

TODO: Fix field descriptor ordering in MessageType constructor - currently groups regular fields first, then oneof fields. Should be in field number order.

## Status

**Current Test Results: 21/29 passing (72%)**

Recent improvements:
- TypeScript keyword escaping (test 15 now passing)
- Enum prefix detection matching protobuf-ts logic (test 20 now passing)
- Oneof field camelCase naming and interface ordering

Remaining work focuses on:
- Field descriptor ordering in reflection metadata
- Proto2 features (default values, groups)
- Comment formatting edge cases
- Proto3 optional field handling


