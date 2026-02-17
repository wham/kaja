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

1. **Reserved type names apply to SERVICE names too:** The `tsReservedTypeNames` list (Array, String, Number, etc.) is checked not only for message/enum types but also for service names. A service named `Array` should be exported as `Array$`, not `Array`. This is checked in `createLocalTypeName()` which is used for messages, enums, AND services.

2. **Check ALL contexts where reserved names are used:**
   - Message/enum/service type names: Check against `reservedKeywords` + `reservedTypeNames`
   - Field names: Check against `reservedObjectProperties` (__proto__, toString) after lowerCamelCase
   - Method names: Check against `reservedClassProperties` after lowerCamelCase
   - Each context has different reserved lists!

3. **lowerCamelCase strips leading underscores:** Any proto name like `__proto__` or `_transport` becomes `Proto` or `Transport` after lowerCamelCase. The reserved lists contain `__proto__` and `_transport`, but these can only trigger with the `use_proto_field_name` option (which preserves original field names).

4. **Compare the actual source:** Look at `/tmp/protobuf-ts/packages/plugin/src/code-gen/local-type-name.ts` for type name escaping and `interpreter.ts` for field/method name escaping. These are separate code paths with different reserved word lists.

5. **Test each type of declaration:** Messages, enums, services, fields, methods, and oneof each have their own naming rules. A reserved name that's OK in one context (e.g., `case` as a field name in an object literal) might not work in another (e.g., as a standalone identifier).

6. **stripPackage() doesn't escape imported types:** The `stripPackage()` function at line 1766 is used when generating service method input/output types (`I:` and `O:` fields in ServiceType at line 4038-4039). While it DOES escape types from the same file (line 1808), it does NOT escape imported types (line 1838-1839). The function returns `simpleName` directly for imported types without calling `escapeTypescriptKeyword()`. This causes a bug: if an imported message is named `String`, `Array`, `Number`, etc., the ServiceType will reference it as `String` instead of `String$`, but the actual type is exported as `String$`. This also affects the import statements - they import `String` instead of `String$`.

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
- Method name generation: Uses `g.toCamelCase()` which strips underscores like TS
- Well-known types: Located in `google/protobuf/*.proto` imports