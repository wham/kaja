## Task

A junior engineer on your team is porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. You are a senior engineer on the team
and your job is find at least one additional case where the tests will fail.

## Steps

1. Analyze what's already in place
2. Clone the TS plugin source code and inspect together with the Go implementation. Identify way to trick it.
3. Update the existing test or add a new one so it fails. Spend substantial effort here.
4. Run the tests
5. Capture important learnings in [Notes](./NELSON.md/#notes). Stuff that will make the task easier for you in the future. For example how to run the tests. How the code is structured. Don't add things that would soften the requirements - i.e. "we are close, this is cosmetic". If you see them, remove them. NELSON.md is your memory. Keep it up to date. Rather than logging test you made to fail, use it to log general tricks and ideas how to break the app.
6. Commit the changes. One line message with summary what was done.
7. If tests are failing, set the content of file status.txt to "HAHA" and end. No exceptions. YOU ARE TRYING TO FIND AT LEAST ONE FAILING TEST.

## Notes

### Tricks to Find Bugs

1. **Check reserved word lists:** TypeScript has multiple lists:
   - `reservedKeywords` - for type and identifier names
   - `reservedTypeNames` - for type names like `Array`, `String`
   - `reservedObjectProperties` - for field names like `__proto__`, `toString`
   - `reservedClassProperties` - for METHOD names like `name`, `constructor`, `close`, `toString`

2. **Method name escaping is different from field name escaping:** Methods can collide with built-in class properties AND gRPC client methods.

3. **Compare the actual source:** Look at `/tmp/protobuf-ts/packages/plugin/src/code-gen/local-type-name.ts` and `interpreter.ts` to see exact logic

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
- Method name generation: Search for `methodName := g.lowerFirst` in main.go