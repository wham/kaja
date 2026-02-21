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

## Notes

- Run tests with `protoc-gen-kaja/scripts/test --summary`. Full output without `--summary`.
- Use `protoc-gen-kaja/scripts/diff <test_name>` to inspect specific failures.
- Results are in `protoc-gen-kaja/results/<test_name>/`. Each has `expected/`, `actual/`, `result.txt`, and optionally `failure.txt`.
- `findMessageType` now searches `g.allFiles` (not just current file + direct deps). This is needed because option extension types can be defined in transitive dependencies (e.g., `google.protobuf.Duration` used as an option value type).
- WKT file generation now matches protoc-gen-ts: only emit WKT files whose types are used as field types (message/enum) or service method input/output in ANY generated file (including self-references within the WKT file itself). This correctly filters out e.g. `duration.ts` when Duration is only used as a custom option value type.
- String escaping: use `escapeStringForJS()` helper for all JS string literals. It handles `\v`, `\f`, `\b`, `\0`, other control chars via `\uXXXX`, plus the standard `\\`, `\"`, `\n`, `\r`, `\t`.
