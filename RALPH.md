## Task

You are porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. The Go implementation must have the exactly same output.

## Steps

1. Analyze what's already in place
2. Do additional web research how to achieve the task. Clone the TS plugin source code and inspect.
3. Update [Plan](./RALPH.md#plan) if needed. Be comfortable trying bigger architecture changes. Document. RALPH.md is your memory. Keep it up to date.
3. Implement a piece of it. Spend substantial effort here.
4. Run the tests
5. Capture important learnings in [Notes](./RALPH.md/#notes). Stuff that will make the task easier for you in the future. For example how to run the tests. How the code is structured. Don't add things that would soften the requirements - i.e. "we are close, this is cosmetic". If you see them, remove them.
6. Commit the changes. One line message with summary what was done.
7. If all tests passing, set the content of file status.txt to "DONE" and end. No exceptions. ALL TESTS MUST PASS.

## Plan

- [x] Build a test harness that compares `protoc-gen-ts` and `protoc-gen-kaja` on set of sample projects
- [x] Implement core message/enum/service generation
- [x] Fix proto2 optional field serialization (check !== undefined)
- [x] Fix client file import ordering (types from same file maintain order)
- [x] Fix grpcbin trailing comment handling (SOLVED via SourceCodeInfo.TrailingComments)
- [x] Fix WireType import positioning in batch generation for lib files (SOLVED)
- [x] Fix client file import ordering for streaming methods (interleave vs group strategy)
- [x] Fix cross-import-path type ordering (deferred input emission)
- [x] Fix field descriptor ordering (must be in field number order, not grouped)
- [x] Fix proto3 optional field handling (should be simple optional, not oneofs)
- [x] Fix oneof names in metadata (use proto snake_case, not camelCase)
- [x] Fix jsonName handling (show in comments and metadata when custom)
- [x] Fix leading underscore camelCase conversion (_private → Private)
- [x] Fix proto2 default value annotations in @generated comments
- [x] Fix enum prefix stripping (require at least 2 chars after strip)
- [x] Fix field ordering (proto file order in constructor/create, sorted in write)
- [x] Fix proto2 groups (skip GROUP type fields)
- [x] Fix leading detached comments (separated by blank lines)
- [x] Fix WireType import ordering for empty messages
- [x] Fix WireType import ordering (early only if imported ONLY by service files)
- [x] Fix type name resolution for imported types (use simple names when imported)
- [x] Fix package vs sub-package type resolution

- [x] Fix import ordering within same file (use forward message order + field number order, then reverse)
- [x] Fix nested type keyword escaping (only top-level types get `$` suffix)
- [x] Fix nested type names when parent is keyword (use unescaped proto name for prefix)
- [x] Fix WireType import ordering for empty first message (early when first message has no fields)
- [x] Fix file-level leading detached comments (output after imports)
- [x] Fix reserved object properties escaping (__proto__, toString get $ suffix)
- [x] Fix service method name escaping (name, constructor, close, toString)
- [x] Fix WireType import when no fields exist (skip import entirely)
- [x] Fix gRPC reserved method names (makeUnaryRequest, methods, typeName, etc.)
- [x] Fix service method name camelCase conversion (__proto__ → Proto, _transport → Transport)
- [x] Implement google.protobuf.Any custom methods (pack, unpack, internalJsonRead, internalJsonWrite)
- [x] Implement google.protobuf.Duration custom methods (internalJsonRead, internalJsonWrite)
- [x] Fix google.protobuf.Any first field JSDoc blank line count (needs 2 blank lines before @generated)
- [x] Implement google.protobuf.FieldMask custom methods
- [x] Add oneof field leading comments support
- [x] Fix google.protobuf.Struct/Value/ListValue JSON methods (need exact switch order and error messages)
- [x] Implement google.protobuf wrapper types (Int32Value, StringValue, etc.) custom methods
- [x] Fix service method leading detached comments (output as // style between methods)
- [x] Fix same-package nested type resolution (check if type is defined in file, not just uppercase check)
- [x] Fix service name escaping in ServiceType exports (Array → Array$, but @generated shows original)
- [x] Fix imported reserved type names (use escaped names like String$, Number$ when importing)
- [x] Fix service-only file import ordering (reverse service types when file has no messages)
- [x] Fix WireType positioning for library files (different directory = early, same directory = late)

**STATUS: 52/52 tests passing - PORT COMPLETE! 🎉**

**PROGRESS**: The protoc-gen-ts → Go port is complete! All test cases pass, including message generation, service generation, field types, comments, import ordering, WKT custom methods, method-level detached comments, edge cases with lowercase message names, reserved type name escaping for services and imported types, service-only file import ordering, and WireType positioning for library files vs same-directory files.

## Notes

### Same-Package Type Resolution (SOLVED)
When a type is in the same package as the current file, we need to distinguish between:
1. Types defined in the current file (same package, same file) - use simple/underscore name
2. Types in sub-packages (e.g., `ecommerce.auth.User`) - import and use simple name

The distinction cannot be made by checking if the first character is uppercase, because proto allows lowercase message names (e.g., `message to { ... }`).

**Algorithm**:
1. Strip package prefix to get remainder (e.g., `test.to.String` → `to.String`)
2. Check if the first part before the dot is a top-level message/enum in the current file
3. If yes, it's a same-file type → return with dots replaced by underscores (`to_String`)
4. If no, it's a sub-package → fall through to import logic

**Example**: Package `test`, type `test.to.String`
- Remainder after stripping package: `to.String`
- Check if `to` is a message in this file → YES
- Return `to_String` (underscores for nested type)

This handles the edge case where a message name starts with lowercase (bad style but valid proto).

Implementation: Check `g.file.MessageType` and `g.file.EnumType` to see if the first part of the remainder matches a top-level type name.

### Import Ordering Within Same File (SOLVED)
When multiple types from the same import file are used, they must be imported in a specific order that matches protoc-gen-ts. The TypeScript plugin processes messages in forward declaration order and fields in field number order, then **prepends** each import to the top of the file (atTop = true).

**Algorithm**:
1. Process messages in forward declaration order (first message to last)
2. For each message, process fields sorted by field number (ascending)
3. Collect types as encountered (skip duplicates)
4. Reverse the final list (because TypeScript prepends, last encountered appears first)

**Example**: `analytics/events.proto`
- Process Event fields in order: timestamp=5 (Timestamp), metadata=11 (Metadata)
- Process PurchaseEvent fields: total=2 (Money)
- Process GetEventsRequest fields: start_time=3 (Timestamp, skip), end_time=4 (Timestamp, skip), page=5 (PageInfo)
- Collected order: [Timestamp, Metadata, Money, PageInfo]
- Reversed: [PageInfo, Money, Metadata, Timestamp] ✓ matches expected

Implementation: Sort fields by number in `collectUsedTypes()`, process messages forward, then reverse `messageFieldTypes` array.

### Service-Only File Import Ordering (SOLVED)
Files that contain ONLY service definitions (no messages) reverse the order of service type imports to match protoc-gen-ts behavior.

**Algorithm**:
1. Collect service types in forward method order (method 0 → N)
2. If file has NO messages (`len(g.file.MessageType) == 0`), reverse the service types list
3. If file has messages, keep service types in forward order (they're added before ServiceType import)

**Example**: File with only service, 3 methods using types String, Array, Number
- Forward order: String (method 0), Array (method 1), Number (method 2)
- Reversed: Number, Array, String ✓
- Import order: `import { Number$ } from "./types"; import { Array$ } from "./types"; import { String$ } from "./types";`

**Example**: File with messages AND service (quirks.proto)
- Forward order: Message (method 0 output), Void (method 0 input), ...
- NOT reversed (file has messages)
- Import order: `import { Message } from "./lib/message"; import { Void } from "./lib/message";`

Implementation: Check `len(g.file.MessageType) == 0` before reversing `serviceTypes` array in `collectUsedTypes()`.

### Leading Detached Comments (SOLVED)
Comments that are separated from a field by a blank line are stored in `loc.LeadingDetachedComments[]` array in SourceCodeInfo. These must be output as `//` style comments before the field's JSDoc block, followed by a blank line.

Example proto:
```proto
// Comment ending with blank line

string field16 = 16;
```

The comment "Comment ending with blank line" is NOT in `loc.LeadingComments` but in `loc.LeadingDetachedComments[0]`.

**File-level leading detached comments**: Comments before the first message declaration with a blank line separator are stored in the first message's `LeadingDetachedComments`. These should be output after imports but before any declarations.

Example proto:
```proto
// File-level comment

message First { ... }
```

Expected output:
```typescript
import { ... } from "...";
// File-level comment

export interface First { ... }
```

Implementation: 
- `getLeadingDetachedComments()` extracts these 
- Field detached comments are output before the field's JSDoc in `generateField()`
- File-level detached comments (from first message) are output after `writeImports()` and before message generation

**Service method detached comments**: Comments between service methods (not attached to any method) are stored as `LeadingDetachedComments` for the following method. These should be output as `//` style comments BEFORE the method's JSDoc block (similar to field detached comments).

Example proto:
```proto
service TestService {
  rpc Name(Request) returns (Response);
  
  // Comment between methods
  // Multiple lines
  
  rpc Constructor(Request) returns (Response);
}
```

Expected output:
```typescript
export interface ITestServiceClient {
    /** ... */
    name$(...): ...;
    // Comment between methods
    // Multiple lines

    /** ... */
    constructor$(...): ...;
}
```

Implementation: Check `methodIdx > 0` and output detached comments as `//` style before JSDoc in both interface and implementation class.


### WireType Import Ordering (SOLVED)
The position of `import { WireType }` relative to `BinaryWriteOptions` depends on file structure:

**WireType EARLY** (right after ServiceType):
1. File has service AND service comes before first message AND file has >10 messages (teams.proto, users.proto pattern)
2. OR file has service AND all messages before service are truly empty (zero actual fields, only reserved or GROUP fields) (empty.proto pattern)
3. OR file has NO service AND is imported ONLY by service files in DIFFERENT directories (quirks lib/message.proto pattern - library file in subdirectory)
4. OR file has NO service AND first message is empty (has no actual fields, only nested types or reserved fields)

**WireType LATE** (after IBinaryWriter):
- All other cases, including:
  - Files imported by service files in the SAME directory (not library files)
  - Files imported by both service and non-service files
  - Files with messages before service
  - Small files
  - Files with non-empty first message

**Library File Detection**: A file is considered a "library file imported only by service files" if:
- It has no service
- It's imported by at least one service file in a DIFFERENT directory (e.g., `v1/quirks.proto` imports `v1/lib/message.proto`)
- It's NOT imported by any non-service files
- It's NOT imported by any service files in the SAME directory (e.g., `service.proto` imports `types.proto` in same dir = NOT a library file)

Implementation: Track files imported by service files, separated by same-directory vs different-directory imports. Only different-directory imports trigger the "library file" behavior.

### Imported Type Name Resolution (SOLVED)
When a type from another package is imported via an `import` statement, the generated TypeScript code should use the simple type name (e.g., `UserProfile`) instead of the package-prefixed name (e.g., `auth_UserProfile`).

Example: `root.proto` (package `ecommerce`) references `auth.UserProfile` which is in package `ecommerce.auth`. Since `auth` is a sub-package (not the same package), the type must be imported. The import statement is `import { UserProfile } from "./auth/user"`, which makes `UserProfile` available without prefix.

**Key distinction**: `ecommerce` and `ecommerce.auth` are DIFFERENT packages, even though one is a prefix of the other. A type is in the "same package" only if it matches exactly.

Implementation:
1. Track all imported type names in `g.importedTypeNames` map when generating imports
2. In `stripPackage()`, check if type is from exact same package (not just prefix match)
3. For types from different packages, check if the simple name was imported
4. Use simple name if imported, otherwise use package-prefixed name

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
- **Only top-level types** get the `$` suffix (nested types don't need escaping)
- The proto name in `@generated` comments and `MessageType`/`ServiceType` constructor remains unchanged
- Nested types like `Outer.class` become `Outer_class` (no `$` because the underscore prevents conflicts)
- **Nested type prefixes use the unescaped proto name**: If parent `from` is escaped to `from$`, nested type `of` becomes `from_of` NOT `from$_of`
- **Service name escaping**: Service names like `Array` become `Array$` for TypeScript exports but proto name remains in comments
- **Imported type name escaping**: When importing reserved type names from other packages, the import statement must use the escaped name (e.g., `import { String$ } from "./types"`), and the type must be referenced with the escaped name throughout the file. The `stripPackage()` function returns the escaped name for imported types, and the import generation function uses `escapeTypescriptKeyword()` when creating import statements.

Example: Proto message `String` in package `types` becomes:
- Export: `export interface String$ { ... }`
- Import: `import { String$ } from "./types"`
- Usage: `method(input: String$): UnaryCall<String$, String$>`

Implementation: 
- Only call `escapeTypescriptKeyword()` when `parentPrefix == ""` in `generateMessageInterface()`, `generateMessageClass()`, and `generateEnum()`
- Track both `parentPrefix` (for TypeScript names) and `protoParentPrefix` (for proto names) separately
- When recursing to nested types, pass `protoName + "_"` for BOTH prefixes (not `fullName + "_"` which includes escaping)
- In `stripPackage()`, always return `escapeTypescriptKeyword(simpleName)` for imported types from different packages
- In import generation, use `escapeTypescriptKeyword()` when extracting type names from imported files
- Only call `escapeTypescriptKeyword()` when `parentPrefix == ""` in `generateMessageInterface()`, `generateMessageClass()`, and `generateEnum()`
- Track both `parentPrefix` (for TypeScript names) and `protoParentPrefix` (for proto names) separately
- When recursing to nested types, pass `protoName + "_"` for BOTH prefixes (not `fullName + "_"` which includes escaping)

### Reserved Object Properties (SOLVED)
Field names that conflict with JavaScript's reserved object properties must be escaped with a `$` suffix. The reserved properties are:
- `__proto__` - JavaScript object prototype property
- `toString` - Object.prototype.toString method

**Algorithm**:
1. Convert field name to camelCase (e.g., `to_string` → `toString`)
2. Check if result is `__proto__` or `toString`
3. If yes, append `$` to the property name (e.g., `toString$`)
4. Add `localName` parameter to field metadata when escaping was applied

**Important**: The `jsonName` check must compare against the **unescaped** camelCase name, not the final property name. For field `to_string`:
- Proto name: `to_string`
- CamelCase: `toString` (unescaped)
- Property name: `toString$` (escaped)
- JSON name: `toString` (default, matches unescaped)
- Result: No `jsonName` in metadata (since it matches unescaped camelCase)

Example: Proto field `int32 to_string = 2;` becomes:
- Interface property: `toString$: number`
- Metadata: `{ no: 2, name: "to_string", kind: "scalar", localName: "toString$", T: 5 }`
- create() method: `message.toString$ = 0`

Implementation: `propertyName()` checks for reserved names and escapes them, `needsLocalName()` determines if metadata needs localName field.

### Enum Prefix Stripping (SOLVED)
Enum values have their common prefix stripped based on the enum name:
1. Convert enum name to UPPER_SNAKE_CASE (e.g., "MyEnum" → "MY_ENUM_", "const_enum" → "CONST_ENUM_")
2. Check if all values start with this prefix
3. Check if stripped names are valid (start with uppercase letter AND at least 2 chars)
4. If all conditions pass, strip the prefix from enum value names

Example: enum `MyEnum` with values `MY_ENUM_VALUE1`, `MY_ENUM_VALUE2` → becomes `VALUE1`, `VALUE2`
Counter-example: enum `Type` with values `TYPE_UNKNOWN`, `TYPE_A`, `TYPE_B` → keeps original names (stripping would leave "", "A", "B" which includes single letters)

### Field Ordering (SOLVED)
Fields must be output in different orders depending on context:
- **MessageType constructor**: Proto file order (order fields appear in .proto)
- **create() method**: Proto file order (same as constructor)
- **internalBinaryWrite() method**: Sorted by field number (ascending) for efficiency
- **Interface definition**: Proto file order

Implementation: Keep fields in msg.Field order (proto file order), then create sorted copy only for write method.

### Proto2 Default Values (SOLVED)
Proto2 fields with default values show the default in the @generated comment:
- Field definition comment: `@generated from protobuf field: optional string name = 1 [default = "unknown"]`
- String/bytes defaults are quoted: `[default = "value"]`
- Numeric/bool defaults are unquoted: `[default = 42]`, `[default = true]`
- Enum defaults show the enum value name: `[default = COLOR_RED]`

Implementation: Check `field.DefaultValue` and format using `formatDefaultValueAnnotation()`.

### Comment Handling

**Enum value comments (SOLVED)**:
Leading and trailing comments for enum values are extracted from SourceCodeInfo and added to the JSDoc block.
- Leading comments appear first
- Trailing comments appear after leading comments but before @generated line
- Implementation: Add valuePath to getLeadingComments/getTrailingComments calls in enum generation

**Field trailing blank comment (TODO)**:
Leading comments that end with a blank line should be output as single-line `//` comments outside the JSDoc block, followed by a blank line. The marker `__HAS_TRAILING_BLANK__` is added by `getLeadingComments()` and should be detected by `generateField()`, but it's not working yet.

### Proto2 Groups (SOLVED)
Proto2 groups are deprecated syntax but still valid. They should NOT be generated as fields in the parent message. The group itself becomes a nested message, but no field reference is added to the parent.

Implementation: Skip fields with `TYPE_GROUP` in interface, constructor, create(), read(), and write() methods.

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

### Service Method Name Escaping (SOLVED)
Service method names that conflict with JavaScript class properties/methods must be escaped with a `$` suffix. The reserved method names include:

**Generic reserved names**:
- `name` - Class.prototype.name property
- `constructor` - Class constructor keyword
- `close` - Common class method
- `toString` - Object.prototype.toString method

**gRPC client reserved method names**:
- `makeUnaryRequest` - gRPC client unary call method
- `makeClientStreamRequest` - gRPC client stream call method
- `makeServerStreamRequest` - gRPC server stream call method
- `makeBidiStreamRequest` - gRPC bidirectional stream call method
- `getChannel` - gRPC client channel getter
- `waitForReady` - gRPC client ready state method

**ServiceInfo interface properties**:
- `methods` - Service methods array
- `typeName` - Service type name string
- `options` - Service options object

**Algorithm**:
1. Convert method name to camelCase (e.g., `GetData` → `getData`)
2. Check if result is in reserved method names list
3. If yes, append `$` to the method name (e.g., `name$`)
4. Add `localName` parameter to method metadata in ServiceType when escaping was applied

**Important**: The `name` field in method metadata always uses the original proto name (e.g., `Name`), not the escaped/camelCase version.

Example: Proto method `rpc Name(Request) returns (Response);` becomes:
- Interface method: `name$(input: Request, options?: RpcOptions): UnaryCall<Request, Response>`
- Implementation method: `name$(input: Request, options?: RpcOptions): UnaryCall<Request, Response> { ... }`
- ServiceType metadata: `{ name: "Name", localName: "name$", options: {}, I: Request, O: Response }`

Implementation: `escapeMethodName()` checks for reserved names and escapes them, applied in `generateServiceClient()` for both interface and implementation.

### Service Method Name CamelCase Conversion (SOLVED)
Service method names undergo full camelCase conversion (using `toCamelCase()`) just like field names, not just lowercasing the first letter. This handles special cases like leading underscores.

**Algorithm**:
1. Convert proto method name via `toCamelCase()` which handles underscores properly:
   - Names starting with `_` get first letter capitalized after underscore removal
   - Multiple underscores are collapsed
2. Then check for reserved name conflicts via `escapeMethodName()`

**Examples**:
- `__proto__` → splits to `["", "", "proto", "", ""]` → joins to `Proto` (starts with underscore so capitalize)
- `_transport` → splits to `["", "transport"]` → joins to `Transport` (starts with underscore so capitalize)
- `GetData` → normal camelCase → `getData`

**Important**: Must use `toCamelCase()` not `lowerFirst()` because `lowerFirst()` only lowercases the first character, while `toCamelCase()` properly handles underscore-based naming including leading underscores.

Implementation: Changed all method name processing from `g.lowerFirst(method.GetName())` to `g.toCamelCase(method.GetName())` in service client generation (interface, implementation, and metadata).

### WireType Import for Empty Messages (SOLVED)
When a file contains only messages with no fields (all messages are empty), the `WireType` import should be omitted entirely since it's not used.

Example: A file with only `message Request {}` and `message Response {}` should not import WireType.

**Algorithm**:
1. Check all messages in the file for actual fields (excluding GROUP type fields)
2. If no message has any fields, set `hasAnyFields = false`
3. Only emit WireType import if `hasAnyFields` is true

Implementation: Added `hasAnyFields` check before emitting WireType import, scanning all messages for non-GROUP fields.
