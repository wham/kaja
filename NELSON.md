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

7. **Oneof names need escaping too:** The TS plugin applies reserved object property escaping to oneof names via `createTypescriptNameForField()` in `interpreter.ts`. The Go plugin just calls `g.toCamelCase()` on the oneof name without any escaping. Oneof names like `toString`, `constructor`, `__proto__` should be escaped. For example, `toString` should become `toString$` in the interface. Also, oneofs starting with `_` are incorrectly detected as proto3 optional (line 1307 in main.go).

8. **Reserved object properties are checked AFTER lowerCamelCase:** In TS plugin's `createTypescriptNameForField()`, the reserved check happens AFTER converting to lowerCamelCase. So `__proto__` becomes `Proto` first, then checked against `['__proto__', 'toString']` - which doesn't match. But `toString` stays `toString` and matches, so it becomes `toString$`. The Go plugin needs to apply the same logic.

9. **Nested imported types must be individually imported:** When a service method uses nested types from another package (e.g., `types.Container.String`), each nested type must be imported separately as `Container_String`, `Container_Array`, etc. The TS plugin uses a symbol table to track which exact types are used and imports only those. The Go implementation incorrectly imports the parent type `Container` when it sees any nested type reference like `types.Container.String`, but then references `Container_String` which was never imported. This affects service method I/O type declarations.

10. **Nested type name collisions:** When a nested type like `Outer.Inner` gets flattened to `Outer_Inner`, it can collide with a top-level type named `Outer_Inner`. The TS plugin detects these collisions and appends `$1`, `$2`, etc. to avoid conflicts (e.g., `Outer_Inner$1` for the nested type). The Go plugin doesn't detect these collisions, causing both types to have the same name which breaks TypeScript compilation. This affects any combination of nested and non-nested types where the flattened name would be identical.

11. **Deeply nested imported types in services:** When a service uses doubly-nested imported types (e.g., `Outer.Middle.Inner` from another file), the Go implementation incorrectly imports the top-level parent (imports `Outer` instead of `Outer_Middle_Inner`). The TS plugin correctly tracks each nested type used and imports them individually. This causes both compilation errors (missing type `Outer_Middle_Inner`) and incorrect imports in the .client.ts file (imports from wrong file). Test with proto files where a service uses `types.Container.Nested.DeepType` - the import should be `Outer_Middle_Inner` from the types file, not `Outer`.

12. **Enum type descriptors in map metadata:** When generating map field metadata (the array passed to MessageType constructor), enum value types should be a 2-element array: `["full.type.name", EnumType]`. The Go implementation incorrectly appends an empty string as a third element: `["full.type.name", EnumType, ""]`. This applies to both local and nested enums used as map values. The TS plugin only generates 2-element arrays for enum type descriptors in all contexts (fields, maps, etc.).

13. **Enums must have a zero value:** The TS plugin requires all enums to have a value numbered 0 for proper TypeScript/JavaScript initialization. When an enum doesn't have a 0 value (which is valid in proto2), the TS plugin synthetically adds `UNSPECIFIED$ = 0` to the generated TypeScript enum. The Go plugin doesn't add this synthetic zero value, causing the generated code to differ. This is found by looking at `/tmp/protobuf-ts/packages/plugin/src/code-gen/enum-generator.ts` where it generates `"@generated synthetic value - protobuf-ts requires all enums to have a 0 value"` comment. Test with a proto2 enum that starts at 1 instead of 0.

14. **File-level deprecation cascades to all elements:** When a proto file has `option deprecated = true`, the TS plugin adds `@deprecated` to EVERYTHING in that file - not just top-level types. The logic in `comment-generator.ts` line 154-173 shows: (1) top-level types (message, enum, service, extension) get `@deprecated` if file.deprecated is true, (2) nested elements (field, rpc, enum_value, oneof) get `@deprecated` if parent.file.deprecated is true. This means every single interface, field, enum value, method, and export in a deprecated file should have the `@deprecated` tag. The Go plugin only checks if individual elements are deprecated, not if the file is deprecated. Additionally, the TS plugin adds a file-level `// @deprecated` comment at the top of generated files (after tslint:disable).

15. **Boolean map keys must be strings in TypeScript:** JavaScript/TypeScript objects can only have string or symbol keys - boolean values are automatically coerced to strings when used as object keys. Therefore, maps with boolean keys must use `{ [key: string]: ValueType }` in the interface, not `{ [key: boolean]: ValueType }`. The TS plugin correctly generates `string` for boolean map keys (see `message-interface-generator.ts` line 111-112 where `rt.ScalarType.BOOL` becomes `StringKeyword`). The Go plugin incorrectly returns `"boolean"` from `getTypescriptTypeForMapKey()` for boolean keys. This also affects the read/write code - boolean keys need to be converted to/from strings with `.toString()` and proper handling of the string representation.

16. **Method idempotency level metadata:** Proto methods can specify `option idempotency_level = NO_SIDE_EFFECTS;` or `option idempotency_level = IDEMPOTENT;` in their definition. The TS plugin reads this from `MethodOptions.idempotency_level` (field 34 in descriptor.proto) and includes it in the ServiceType method metadata as `idempotency: "NO_SIDE_EFFECTS"` or `idempotency: "IDEMPOTENT"`. When the idempotency level is `IDEMPOTENCY_UNKNOWN` (the default), the field is omitted. The Go plugin doesn't read or generate this field at all. Check `interpreter.ts` in the TS plugin where it switches on `methodDescriptor.idempotency` and sets `info.idempotency` accordingly. This metadata is part of the runtime method reflection info used by RPC clients.

17. **Field-level jstype option overrides global long_type:** Proto files can specify `[jstype = JS_STRING]`, `[jstype = JS_NUMBER]`, or `[jstype = JS_NORMAL]` on individual int64/uint64/fixed64/sfixed64 fields to override the global `long_type` parameter. The TS plugin checks `field.options.jstype` (see `interpreter.ts` getL() method around line 580-605) and generates the appropriate TypeScript type (`string` for JS_STRING, `number` for JS_NUMBER, `bigint` for JS_NORMAL). The Go plugin ignores this per-field option and always uses the global `g.params.longType` setting (see main.go line 2299). This affects: (1) interface field types, (2) default values (`"0"` vs `0`), (3) MessageType metadata (`L: 2 /*LongType.NUMBER*/`), (4) reader methods (`.toString()` vs `.toNumber()`), (5) writer comparisons (`!== "0"` vs `!== 0`), (6) field comments (should include `[jstype = ...]` annotation). When JS_NUMBER is set, the field must be `number` type and use `.toNumber()` for reading, even if global long_type is `string`.

18. **Proto2 packed option must be respected:** In proto2, repeated numeric/bool/enum fields are UNPACKED by default, unlike proto3 where they're PACKED. Proto2 allows explicit `[packed=true]` or `[packed=false]` annotations to override the default. The TS plugin reads `fieldDescriptor.packed` from the descriptor to determine the actual packing (line 425 in interpreter.ts). The Go plugin's `isPackedType()` function only checks if the field type is packable (numeric/bool/enum) but doesn't check `field.Options.GetPacked()` or the file syntax. This causes: (1) proto2 fields to be incorrectly marked as PACKED when they should be UNPACKED by default, (2) explicit `[packed=false]` to be ignored, (3) missing `[packed = true/false]` annotations in comments. The fix requires checking both the file syntax and the explicit packed option on each field.

19. **Bytes field default values need proper escaping in comments:** Proto2 allows default values for bytes fields, and these need to be properly escaped in TypeScript/JavaScript comments. The Go plugin double-escapes quote characters in bytes default value annotations, generating `\\"` instead of `\"`. In TypeScript/JavaScript comments (both JSDoc `/** */` and inline `/* */`), a single backslash escape `\"` is sufficient to represent a quote character. The issue appears in `formatDefaultValueAnnotation()` or similar escaping logic for bytes defaults. Test with proto2 bytes fields with defaults like `[default = "\""]` or `[default = "hello\x00\t\"test"]` - the comments should show `\"` not `\\"`.

20. **Custom method options only look at current file extensions:** The Go plugin's `getCustomMethodOptions()` at line 287 only searches `g.file.Extension` - extensions defined in the CURRENT file being generated. It doesn't search imported proto files for extension definitions. The TS plugin's `readOptions()` iterates over `this.registry` (line 139 in interpreter.ts), which contains ALL files in the protoc request, not just the current file. When a proto file imports custom MethodOptions extensions from another file and uses them (e.g., `import "options.proto"; option (custom.auth_level) = "admin";`), the Go plugin outputs `options: {}` because it can't find the extension definition, while the TS plugin correctly outputs `options: { "custom.auth_level": "admin" }`. Fix requires building the extension map from ALL files in `g.request.ProtoFile`, not just `g.file.Extension`.

21. **Enum aliases with allow_alias option:** Proto2 and proto3 allow multiple enum values to have the same number when `option allow_alias = true` is set. When enum aliases exist, the TS plugin has a quirk: for aliased values (values with duplicate numbers), it does NOT include the proto source comment in the generated JSDoc. Instead, it only shows the `@generated from protobuf enum value` line with the FIRST value's name that has that number. For example, if `STARTED = 1` comes first and `RUNNING = 1` is an alias, the TS plugin generates `@generated from protobuf enum value: STARTED = 1;` for RUNNING, completely ignoring any comment on RUNNING in the proto file. The Go plugin currently includes the proto comment and generates the correct value name. This is an edge case where the TS plugin's behavior seems incorrect, but to match it exactly, aliases need special handling to omit source comments and reference the first value's name. Check `enum-generator.ts` in the TS plugin for how it processes enum values with duplicate numbers.

22. **Repeated fields with jstype use wrong reader method when packed:** When a repeated int64/uint64 field has `[jstype = JS_NUMBER]` or `[jstype = JS_STRING]`, the field-level jstype must override the global long_type in BOTH packed and unpacked reading. Proto2 repeated numeric fields can be packed or unpacked. The Go plugin correctly applies jstype to unpacked reads (single value), but incorrectly uses the global long_type for packed reads (LengthDelimited wire type). For example, `repeated int64 values = 1 [jstype = JS_NUMBER]` should use `.toNumber()` in both cases, but the Go plugin uses `.toString()` (from global long_type) when reading the packed format. The bug is in the packed repeated read generation - it needs to check the field's jstype option, not just the global setting. Check lines where `WireType.LengthDelimited` is handled for repeated int64/uint64 fields.

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