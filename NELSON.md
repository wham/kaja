## Task

A junior engineer on your team is porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. You are a senior engineer on the team
and your job is find at least one additional case where the tests will fail.

## Steps

1. Analyze what's already in place
2. Clone the TS plugin source code and inspect together with the Go implementation. Identify way to trick it.
3. Update [Plan](./NELSON.md#plan) if needed. Be comfortable making bigger changes to the test data. NELSON.md is your memory. Keep it up to date. Rather than logging test you made to fail, use it to log general tricks and ideas how to break the app.
3. Update the existing test or add a new one so it fails. Spend substantial effort here.
4. Run the tests
5. Capture important learnings in [Notes](./NELSON.md/#notes). Stuff that will make the task easier for you in the future. For example how to run the tests. How the code is structured. Don't add things that would soften the requirements - i.e. "we are close, this is cosmetic". If you see them, remove them.
6. Commit the changes. One line message with summary what was done.
7. If tests are failing, set the content of file status.txt to "HAHA" and end. No exceptions. YOU ARE TRYING TO FIND AT LEAST ONE FAILING TEST.

## Plan

- [x] Analyze the source code 
- [x] Clone TS plugin source and compare
- [x] Identify bug in nested type name escaping
- [x] Create failing test (31_nested_with_keyword)
- [x] Run tests to confirm failure
- [x] Find ANOTHER bug (reserved object properties)
- [x] Create test 33_reserved_properties
- [x] Confirm test 33 fails
- [x] Update NELSON.md
- [x] Commit and set status.txt

## Notes

### Bug Found: Incorrect Keyword Escaping for Nested Types

**The Bug:**
The Go implementation escapes individual component names BEFORE merging them with underscores, while the TypeScript implementation merges first, THEN checks if the final merged name is a reserved keyword.

**Example:**
- Proto: `message Outer { message class { string value = 1; } }`
- Full type name: `.test.Outer.class`
- After removing package: `Outer.class`

**TypeScript (Correct):**
1. Replace dots with underscores: `Outer.class` → `Outer_class`
2. Check if `Outer_class` is a reserved keyword → NO
3. Final name: `Outer_class`

**Go (Incorrect):**
1. Escape each component: `Outer` (OK), `class` → `class$`
2. Merge with underscores: `Outer_class$`
3. Final name: `Outer_class$` (WRONG!)

**Test results:**
- Expected: `export interface Outer_class`
- Actual: `export interface Outer_class$`

**More complex example:**
- Proto: `message Level1 { message interface { message type { } } }`
- Expected: `Level1_interface_type`
- Actual: `Level1_interface$_type$` (escapes BOTH components!)

**The Fix:**
The Go code needs to:
1. Build the full merged name first (with underscores)
2. Then check if the FINAL name is a reserved keyword
3. Only escape if the final merged name matches a reserved word

### How to run tests

```bash
cd /Users/tom-newotny/kaja/protoc-gen-kaja
./scripts/test
./scripts/test --summary  # Just show pass/fail summary
```

### Code structure

- `main.go`: Main plugin implementation
- `tests/`: Test cases with .proto files
- `scripts/test`: Test runner that compares protoc-gen-kaja output vs protoc-gen-ts
- Bug 1 (nested keywords): in `generateMessageInterface` and `generateMessageClass` - escape too early
- Bug 2 (reserved props): in `propertyName`/`toCamelCase` - missing reserved object property escaping

### Bug #2: Missing Reserved Object Property Escaping

**The Bug:**
The Go implementation doesn't escape field names that are reserved JavaScript object properties like `__proto__` and `toString`.

**TypeScript (Correct):**
```typescript
const reservedObjectProperties = '__proto__,toString'.split(',');
if (reservedObjectProperties.includes(name)) {
    name = name + escapeCharacter;
}
```

**Go (Missing):**
The `propertyName()` and `toCamelCase()` functions convert field names to camelCase but don't check for reserved object properties.

**Example:**
- Proto: `int32 to_string = 1;`
- After camelCase: `toString`
- Expected: `toString$` (escaped)
- Actual: `toString` (NOT escaped - BUG!)

**Impact:**
Fields named `__proto__` or `to_string` (becomes `toString`) will break at runtime because they collide with built-in Object properties.

**Test case: 33_reserved_properties**
- Fails because `toString` should be `toString$`
- Also tests `__proto__` field name