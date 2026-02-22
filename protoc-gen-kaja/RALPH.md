## Task

You are porting [protoc-gen-ts](https://github.com/timostamm/protobuf-ts/tree/main/packages/plugin) to Go plugin `protoc-gen-kaja`. The Go implementation must produce **byte-for-byte identical output** to the TypeScript original. No exceptions. No "close enough".

## How This Works

You are running inside an automated loop. **Each invocation is stateless** — you have no memory of previous runs. This file (RALPH.md) is your only persistent memory. Read it first. Write to it before you finish. Your future self depends on it.

## Steps (follow this order every run)

1. **Read state.** Read the [Plan](#plan) and [Notes](#notes) sections below. Understand where you left off. Don't redo work that's already done.
2. **Orient.** If Plan is empty, analyze the codebase, research the TS plugin (clone it if needed), and write a detailed plan. If Plan exists, pick the next incomplete item.
3. **Implement.** Spend the bulk of your effort here. Work on ONE failing test case or feature at a time. Make real, substantive progress.
4. **Test.** Run the tests. Read the output carefully. If a test fails, understand WHY before changing code.
5. **Update memory.** Update [Plan](#plan) with what's done and what's next. Update [Notes](#notes) with learnings that will help future runs. Be specific — file paths, function names, gotchas, how to run tests.
6. **Commit.** One-line past-tense message summarizing what changed.
7. **Check completion.** If ALL tests pass, write "DONE" to protoc-gen-kaja/status.txt and stop. If any test fails, do NOT write DONE. Just end — you'll run again.

## Rules

- **DONE means ALL tests pass.** Not most. Not "the important ones". ALL. Zero failures.
- **Never weaken requirements.** Don't modify test expectations. Don't skip tests. Don't add notes like "close enough" or "cosmetic difference". If you see such notes below, delete them.
- **Never mark DONE prematurely.** Run the full test suite and confirm zero failures before writing DONE.
- **Be bold with architecture.** If the current approach is fundamentally wrong, refactor it. Document why in the plan.
- **Keep Notes actionable.** Good: "Run tests with `protoc-gen-kaja/scripts/test`. Failures show as diffs." Bad: "Making good progress overall."
- **One thing at a time.** Fix one test, commit, move to the next. Don't try to fix everything in one run.

## Plan

- [x] Fix custom options with WKT message types (test 239_wkt_custom_option)
  - Fixed `findMessageType` to search all files, not just direct deps (transitive deps like Duration used as option value types)
  - Added `isWKTFileUsed` filter to only generate WKT .ts files whose types are actually used as field types or service method types (matching protoc-gen-ts behavior)
- [x] Fix custom option property keys with hyphens (test 240_custom_option_hyphen_json_name)
  - Added `needsQuoteAsPropertyKey()` in `formatCustomOptions` to quote keys that aren't valid JS identifiers (e.g. `my-value` → `"my-value"`)
  - Must skip already-quoted keys (numeric map keys like `"1"` are pre-quoted)
- [x] Fix string escaping for control characters (test 241_custom_option_string_vtab)
  - Created `escapeStringForJS()` helper matching TypeScript compiler's `escapeString` behavior
  - Handles `\v`, `\f`, `\b`, `\0`, and other control chars via `\uXXXX`
  - Replaced duplicated escaping code in `formatCustomOptions`, `formatCustomOptionArray`, and jsonName escaping
- [x] Fix integer map key ordering in custom options (test 242_custom_map_int_key_order)
  - Added `sortMapEntriesJSOrder()` to sort `[]customOption` map entries after merging in `mergeRepeatedOptions`
  - Matches JavaScript Object.keys() enumeration: array-index keys (0..2^32-2) first in ascending numeric order, then non-integer keys in insertion order
  - Strips quotes from keys before checking `isArrayIndex()` since numeric map keys are stored pre-quoted (e.g. `"1"`, `"10"`)
- [x] Fix single-element repeated fields in custom options (test 243_custom_option_repeated_single)
  - After `mergeRepeatedOptions` in `parseMessageValue`, check `msgDesc.Field` for `LABEL_REPEATED` fields
  - Wrap any non-array values in `[]interface{}` for repeated fields (skip map entries)
  - Matches protobuf-ts `toJson()` which always emits arrays for repeated fields
- [x] Fix U+2028/U+2029 escaping in JS string literals (test 244_custom_option_string_linesep)
  - Added `r == 0x2028 || r == 0x2029` check in `escapeStringForJS()` to escape LINE SEPARATOR and PARAGRAPH SEPARATOR
  - These chars are not valid unescaped in JS string literals (pre-ES2019), TypeScript's printer escapes them
- [x] Fix single-element repeated extension fields (test 245_repeated_extension_single)
  - Added array-wrapping logic in `parseCustomOptions` (not just `parseMessageValue`) for top-level repeated extensions
  - Builds a `repeatedExts` set from `extensionMap` entries with `LABEL_REPEATED`, skipping map entries
  - After `mergeRepeatedOptions`, wraps non-array values in `[]interface{}` for repeated extensions
- [x] Fix string map key escaping in custom options (test 246_custom_map_string_key_escape)
  - Called `escapeStringForJS()` on map keys before quoting them in `formatCustomOptions`
  - Fixes backslash and double-quote characters in string map keys (e.g. `back\slash` → `"back\\slash"`)
- [x] Fix C1 control character escaping in JS strings (test 247_custom_option_string_nextline)
  - Added `(r >= 0x7F && r <= 0x9F)` and `r == 0xFEFF` checks in `escapeStringForJS()`
  - U+0085 (NEXT LINE / NEL) is a C1 control character that TypeScript's printer escapes as `\u0085`
  - Also covers DEL (0x7F), other C1 chars, and BOM (0xFEFF) to match TypeScript's `escapeString`
- [x] Fix null byte followed by digit escaping (test 248_custom_option_string_null_digit)
  - When `\0` is followed by a digit (0-9), use `\x00` instead to avoid ambiguous octal escape
  - Changed `escapeStringForJS()` to iterate over `[]rune` slice so we can peek at the next character
- [x] Fix custom option cross-file ordering (test 249_custom_option_cross_file_order)
  - Added `registryOrder` field to `extInfo` to track discovery order of extensions across files
  - After merging, sort custom options by registry order (file processing order) instead of wire order (field number)
  - TS plugin uses registration order (order extensions are encountered during file processing), not field number order
- [x] Fix custom option field order within message values (test 250_custom_option_field_order)
  - Added `sort.SliceStable` in `parseMessageValue` after merging to reorder fields by message descriptor declaration order
  - protoc serializes by field number, but protobuf-ts `toJson()` emits in declaration order (order fields appear in the .proto file)
- [x] Fix DEL character escaping in JS strings (test 251_custom_option_string_del)
  - Changed C1 range from `r >= 0x7F` to `r >= 0x80` — DEL (0x7F) is NOT escaped by TypeScript's printer
  - C1 control characters are 0x80–0x9F; DEL is technically a control char but TS passes it through literally
- [x] Fix non-ASCII character escaping in JS strings (test 253_custom_option_string_nonascii)
  - Changed condition from specific ranges `(r >= 0x80 && r <= 0x9F) || r == 0x2028 || r == 0x2029 || r == 0xFEFF` to `r >= 0x80`
  - TypeScript's printer uses `escapeNonAsciiString` which escapes ALL chars outside 0x0000-0x007F range
  - Regex `/[^\u0000-\u007F]/g` means 0x7F (DEL) is NOT escaped but 0x80+ ALL are
  - Added `\u{X}` format for supplementary chars (> U+FFFF) to match TS behavior
- [x] Fix supplementary character escaping to use surrogate pairs (test 254_custom_option_string_emoji)
  - Changed `\u{X}` format to surrogate pair `\uHHHH\uHHHH` for chars > U+FFFF
  - TypeScript's `escapeString` uses `\uHHHH\uHHHH` surrogate pairs, not ES6 `\u{X}` syntax
- [x] Fix group field custom options index-shift bug (test 255_group_field_options)
  - protobuf-ts has a bug in `getMessageType()`: it reads custom options using array index alignment between original descriptor fields (includes groups) and filtered fields (no groups), causing options to shift
  - Added `customOptionsSource` field to `fieldInfo` struct; for filtered field at index `i`, use `msg.Field[i].Options`
  - This replicates the bug where fields after a group get the wrong (or no) custom options
- [x] Fix enum alias resolution in custom options (test 256_custom_option_enum_alias)
  - When enum has `allow_alias`, use the LAST value with matching number (JS object overwrite behavior)
  - Changed `resolveEnumValueName` and `findEnumInMessageWithPrefix` to iterate all values and keep last match
- [x] Fix default value omission in custom option messages (test 257_required_default_option)
  - Added `isDefaultValue()` helper to check if a field value equals its proto3 JSON default (0, "", false, "0", etc.)
  - Added filtering step in `parseMessageValue` after merge: removes fields with default values (matching protobuf-ts `toJson()` behavior)
  - Skips map entry messages — key/value fields are always meaningful even when they equal defaults (e.g., bool key `false`)
- [x] Fix proto2 optional fields keeping defaults in custom options (test 258_optional_default_option)
  - Added `findFileSyntaxForMessageType()` to look up file syntax for a message type
  - Changed `parseMessageValue` to accept `msgTypeName` parameter for syntax lookup
  - Proto2 optional fields have explicit presence (opt=true in protobuf-ts) → defaults are NOT filtered
  - Proto3 explicit optional fields also have presence → defaults kept
  - Only proto2 required and proto3 implicit fields have defaults filtered
  - Note: `GetSyntax()` returns "" for proto2 files (not "proto2"), so check `syntax == "proto2" || syntax == ""`
- [x] Fix google.protobuf.NullValue rendering as `null` in custom options (test 259_custom_option_null_value)
  - protobuf-ts `ReflectionJsonWriter.enum()` special-cases NullValue to emit JSON `null` instead of enum name
  - At all 3 enum resolution sites in custom options, check if typeName is `.google.protobuf.NullValue` → store `nil` instead of enum name string
  - Added `nil` case in `formatCustomOptions` and `formatCustomOptionArray` → outputs `"null"` literal
  - Updated `isDefaultValue` to handle NullValue: `nil` is the default value (NullValue only has value 0)
- [x] Fix map field jstype propagation to value field (test 260_map_int64_jstype)
  - Added `mapValueWithJstype()` helper that copies jstype from outer map field to synthetic value field
  - Applied at 4 locations: interface type, createDefault type, binary read method, map value default
  - Added jstype-aware L parameter in field info V part for map scalar values
  - Added jstype checks in `getMapValueDefault` for `0n` (BIGINT) and `0` (NUMBER) defaults
- [x] Fix proto3 oneof scalar fields keeping defaults in custom options (test 261_custom_option_oneof_default)
  - TS plugin's `ReflectionJsonWriter.write()` forces `emitDefaultValues=true` for scalar/enum oneof members
  - Added `fd.OneofIndex != nil` check to `hasPresence` in proto3 branch of default-value filtering
  - Oneof members always have presence semantics, so their default values should not be filtered
- [x] Fix create() property collision ordering (test 264_create_property_collision)
  - When two fields collide on localName (e.g. `x_1_y` and `x1y` both → `x1Y`), the property must appear at the position of the FIRST occurrence (JS Object.entries semantics) but with the LAST occurrence's value
  - Changed dedup in create() from reverse-iterate to forward-iterate with index tracking: first occurrence sets position, later occurrences overwrite value in-place
- [x] Fix ts.client service option not excluded (test 265_ts_client_service_option)
  - protobuf-ts hardcodes exclusion of only `ts.client` from service options output (NOT `ts.server`)
  - Added filtering in `getCustomServiceOptions` to skip options with key `ts.client`
- [x] Implement ts.exclude_options file option (test 266_ts_exclude_options)
  - Added `getExcludeOptions()` to read field 777701 (ts.exclude_options) from FileOptions unknown fields
  - Added `filterExcludedOptions()` helper supporting exact match and trailing wildcard patterns
  - Applied filtering in all four `getCustom*Options` methods (field, message, method, service)
- [x] Fix ts.exclude_options wildcard substring matching (test 267_exclude_options_wildcard_substring)
  - TS plugin converts patterns to regex (dots escaped, `*` → `.*`) and uses `String.match()` (substring, not anchored)
  - Changed `filterExcludedOptions` from prefix-based matching to regex substring matching
  - Pattern `test.*` now correctly matches `other.test.foo` (finds "test.foo" as substring)
- [x] Fix ts.exclude_options literal exact match (test 268_exclude_options_literal_exact)
  - Literal patterns (no `*`) must use exact match (`key === pattern`), not regex substring
  - Split `filterExcludedOptions` into two paths: literals use `==`, wildcards use regex substring match
  - Pattern `test.tag` now only excludes key `test.tag`, not `prefix.test.tag`
- [x] Implement gRPC server file generation (test 269_ts_server_service_option)
  - Only `ts.client` is excluded from service options (NOT `ts.server` — fixed previous incorrect exclusion)
  - Added `getServiceServerStyles()` to read `ts.server` (field 777702) from ServiceOptions unknown fields
  - Handles packed repeated encoding: protoc sends repeated enums as BytesType containing packed varints
  - Added `isVarintFieldType()` and `parseVarintValue()` helpers for packed repeated support in `parseCustomOptions`
  - Implemented `generateGrpcServerFile()` producing `.grpc-server.ts` with:
    - Interface `I{ServiceName}` extending `grpc.UntypedServiceImplementation`
    - Service definition const `{camelServiceName}Definition: grpc.ServiceDefinition<I{ServiceName}>`
    - Method entries with path, originalName, stream flags, and serialize/deserialize functions
  - Triggered when any service has `ts.server = GRPC1_SERVER` (value 2)
- [x] Implement generic server file generation (test 270_generic_server_option)
  - Added `generateGenericServerFile()` producing `.server.ts` with:
    - Interface `I{ServiceName}<T = ServerCallContext>` with method signatures
    - Unary: `method(request: I, context: T): Promise<O>`
    - Server streaming: `method(request: I, responses: RpcInputStream<O>, context: T): Promise<void>`
    - Client streaming: `method(requests: RpcOutputStream<I>, context: T): Promise<O>`
    - Bidi: `method(requests: RpcOutputStream<I>, responses: RpcInputStream<O>, context: T): Promise<void>`
  - Triggered when any service has `ts.server = GENERIC_SERVER` (value 1)
  - Imports: message types (value imports, reverse method order) then ServerCallContext from runtime-rpc
- [x] Fix generic server import interleaving (test 272_generic_server_import_interleave)
  - TS plugin prepends imports as encountered per-method, so RpcInputStream/RpcOutputStream are interleaved with message imports
  - Changed from collecting all message imports + emitting streaming at top, to simulating prepend-as-encountered per method
  - For each method (forward order): prepend input type, output type, then RpcInputStream/RpcOutputStream if needed
- [x] Fix bidi streaming import order (test 273_generic_server_bidi)
  - For bidi, TS plugin's createBidi() encounters RpcOutputStream (requests) before RpcInputStream (responses)
  - Since imports are prepended, must prepend RpcOutputStream first, then RpcInputStream goes on top
  - Swapped cs/ss check order in the import loop
- [x] Suppress client file when ts.client = NO_CLIENT (test 274_no_client_service_option)
  - Added `getServiceClientStyles()` to read field 777701 from ServiceOptions unknown fields (same pattern as server styles)
  - Added `fileNeedsClient()`: returns false only if ALL services explicitly set NO_CLIENT (0); default (no option) is GENERIC_CLIENT
  - Changed client file generation guard from `len(file.Service) > 0` to also check `fileNeedsClient(file)`
- [x] Implement gRPC client file generation (test 275_grpc1_client_option)
  - Added `serviceNeedsGrpc1Client()`, `fileNeedsGrpc1Client()`, `getGrpcClientOutputFileName()` helpers
  - Changed `fileNeedsClient()` to only return true for GENERIC_CLIENT (1), not GRPC1_CLIENT (4)
  - Implemented `generateGrpcClientFile()` producing `.grpc-client.ts` with:
    - Interface `I{ServiceName}Client` with method overloads for each streaming type
    - Class `{ServiceName}Client` extending `grpc.Client` with `_binaryOptions`, constructor, and method implementations
    - Unary: 4 overloads (metadata+options+callback, metadata+callback, options+callback, callback)
    - Uses `makeUnaryRequest`, `makeServerStreamRequest`, `makeClientStreamRequest`, `makeBidiStreamRequest`
    - Callback types wrapped in parens `((...) => void)` in union positions in implementation signatures
  - Imports: service value, BinaryWriteOptions/BinaryReadOptions type, message types, `import * as grpc`
- [x] Fix gRPC client server streaming method signatures (test 276_grpc1_client_streaming)
  - Interface: metadata is optional (`metadata?: grpc.Metadata`), not required
  - Implementation: metadata is optional union (`metadata?: grpc.Metadata | grpc.CallOptions`), not `metadata: ... | undefined`
  - Implementation body: `options` passed directly (no `(options as any)` cast) for server streaming
- [x] Fix gRPC client bidi streaming method signatures (test 277_grpc1_client_bidi)
  - Same two bugs as server streaming: `metadata` should be optional (`?:`) not `| undefined`, `options` passed directly not `(options as any)`
  - Applied same fix to the `cs && ss` (bidi) code path in `generateGrpcClientFile`
- [x] Fix generic server method @deprecated inheriting from service deprecation (test 281_generic_server_deprecated_service)
  - Removed `service.GetOptions().GetDeprecated()` check from method deprecation in `generateGenericServerFile`
  - Service-level deprecation should NOT propagate to individual methods in the server interface
  - Only method-level `deprecated = true` and file-level deprecation should add `@deprecated` to methods
- [x] Fix gRPC client import ordering (test 282_grpc_client_import_order)
  - Switched from backward-iterate+append to forward-iterate+prepend strategy (matching TS plugin behavior)
  - TS plugin processes methods forward, prepending imports as types are encountered
  - For unary/server-stream/bidi: prepend input first, then output (output ends up above input)
  - For client-stream: prepend output first, then input (input ends up above output)
- [x] Fix gRPC server import ordering (test 283_grpc_server_import_order)
  - Same forward-iterate+prepend fix as generic server and gRPC client
  - For each method: prepend input first, then output (output ends up above input)
  - Previous reverse-iterate+append approach failed when two methods share types in swapped positions
- [x] Fix service-only import ordering when file has messages (test 284_grpc_server_alias_import)
  - Removed `len(g.file.MessageType) == 0` guard from per-method-pair reversal of serviceTypes
  - Service-only external imports always need prepend ordering (last method's types first), regardless of whether the file has messages
  - The guard was incorrect: it caused service-only imports to be emitted in forward order when messages existed

## Notes

- Run tests with `protoc-gen-kaja/scripts/test --summary`. Full output without `--summary`.
- Use `protoc-gen-kaja/scripts/diff <test_name>` to inspect specific failures.
- Results are in `protoc-gen-kaja/results/<test_name>/`. Each has `expected/`, `actual/`, `result.txt`, and optionally `failure.txt`.
- `findMessageType` now searches `g.allFiles` (not just current file + direct deps). This is needed because option extension types can be defined in transitive dependencies (e.g., `google.protobuf.Duration` used as an option value type).
- WKT file generation now matches protoc-gen-ts: only emit WKT files whose types are used as field types (message/enum) or service method input/output in ANY generated file (including self-references within the WKT file itself). This correctly filters out e.g. `duration.ts` when Duration is only used as a custom option value type.
- String escaping: use `escapeStringForJS()` helper for all JS string literals. It handles `\v`, `\f`, `\b`, `\0`, other control chars via `\uXXXX`, plus the standard `\\`, `\"`, `\n`, `\r`, `\t`. ALL non-ASCII chars (>= 0x80) are escaped as `\uXXXX` (or surrogate pairs `\uHHHH\uHHHH` for supplementary chars > U+FFFF), matching TypeScript's `escapeNonAsciiString`. DEL (0x7F) is NOT escaped.
