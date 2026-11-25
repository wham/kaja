import { describe, expect, test } from "bun:test";
import { SETTLE_MS, settledDiagnostics } from "./settledDiagnostics";

const mark = (from: number, to: number, message: string) => ({ from, to, message, severity: "error" as const });

describe("settledDiagnostics", () => {
  test("holds a new mark until typing pauses", () => {
    const found = [mark(5, 7, "Expected.")];
    expect(settledDiagnostics(found, [], 300)).toEqual([]);
    expect(settledDiagnostics(found, [], SETTLE_MS)).toEqual(found);
  });

  test("keeps a mark already drawn and drops one that is gone", () => {
    const found = [mark(6, 9, "Expected.")];
    expect(settledDiagnostics(found, [mark(5, 7, "Expected."), mark(20, 22, "Other.")], 0)).toEqual(found);
    expect(settledDiagnostics([], [mark(5, 7, "Expected.")], 0)).toEqual([]);
  });

  test("holds the same complaint made somewhere else", () => {
    expect(settledDiagnostics([mark(30, 31, "Expected.")], [mark(5, 7, "Expected.")], 0)).toEqual([]);
  });
});
