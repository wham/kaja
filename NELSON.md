## Task

A junior engineer on your team is porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. You are a senior engineer on the team
and your job is find at least one additional case where the tests will fail.

## Steps

1. Analyze what's already in place
2. Clone the TS plugin source code and inspect together with the Go implementation. Identify way to trick it.
3. Update [Plan](./NELSON.md#plan) if needed. Be comfortable making bigger changes to the test data. NELSON.md is your memory. Keep it up to date.
3. Update the existing test or add a new one so it fails. Spend substantial effort here.
4. Run the tests
5. Capture important learnings in [Notes](./NELSON.md/#notes). Stuff that will make the task easier for you in the future. For example how to run the tests. How the code is structured. Don't add things that would soften the requirements - i.e. "we are close, this is cosmetic". If you see them, remove them.
6. Commit the changes. One line message with summary what was done.
7. If tests are failing, set the content of file status.txt to "HAHA" and end. No exceptions. YOU ARE TRYING TO FIND AT LEAST ONE FAILING TEST.

## Plan

- [x] Analyze the source code 
- [x] Clone TS plugin source and compare
- [x] Identify bug in parent prefix using escaped names
- [x] Create failing test (32_merged_keyword)
- [x] Run tests to confirm failure
- [ ] Commit and update status.txt

## Notes

### Bug Found: Parent Prefix Uses Escaped Names

**The Real Bug:**
Test 31_nested_with_keyword was already fixed in commit 77cda53. The ACTUAL bug is that when building the parent prefix for nested types, the Go code uses the ESCAPED name instead of the ORIGINAL name.

**TypeScript Implementation (Correct):**
From `/tmp/protobuf-ts/packages/plugin/src/code-gen/local-type-name.ts`:
1. Get full type name (e.g., `.test.from.of`)
2. Remove package prefix (e.g., `from.of`)
3. Replace ALL dots with underscores (e.g., `from_of`)
4. Check if FINAL merged name is a keyword
5. Only escape if final name matches

**Go Implementation (Incorrect):**
In `main.go` line 1060:
1. Escapes top-level name: `from` → `from$` (because "from" is a keyword)
2. Builds nested with escaped parent: `from$ + "_" + of` → `from$_of`
3. Result: `from$_of` (WRONG!)

**Example that fails:**
```proto
message from {
  message of {
    string value = 1;
  }
}
```

- Expected (TS): `from_of` (because `from_of` is NOT a keyword)
- Actual (Go): `from$_of` (because parent `from` was escaped to `from$`)

**Root Cause:**
Line 1160 in `main.go`: `g.generateMessageInterface(nested, fullName + "_", nestedPath)`

It passes `fullName` (which contains the escaped name) as the parent prefix for nested types. It should pass a prefix built from UNESCAPED names, and only escape the FINAL merged result.

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
- The bug is in line 1160: passes `fullName + "_"` (escaped) instead of unescaped names
- When generating nested types, parent prefix contains escaped names, polluting nested type names