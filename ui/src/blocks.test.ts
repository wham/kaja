import { describe, expect, it } from "bun:test";
import { Block, blockLabel, cellRun, formatCell, isAwaitingUser, RunCell, TableBlock, withCellRun, withoutRowRuns } from "./blocks";

describe("isAwaitingUser", () => {
  it("is true only for a question nobody has answered", () => {
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?", answerType: "str" })).toBe(true);
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?", answerType: "str", answer: "june" })).toBe(false);
  });

  // A cancelled ask stopped the script rather than parking it, so the run is
  // over — showing it as waiting would offer an input nothing is listening to.
  it("is false for a question that was cancelled", () => {
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?", answerType: "str", cancelled: true })).toBe(false);
  });

  it("is true for a call nobody has approved, and false once they have", () => {
    const held: Block = { kind: "approve", method: "Shows.CreateShow", request: "{}" };
    expect(isAwaitingUser(held)).toBe(true);
    expect(isAwaitingUser({ ...held, decision: "approved" })).toBe(false);
    expect(isAwaitingUser({ ...held, decision: "rejected" })).toBe(false);
  });

  it("is false for anything a run merely drew", () => {
    expect(isAwaitingUser({ kind: "text", text: "Reconciling" })).toBe(false);
  });
});

describe("blockLabel", () => {
  it("describes a table by its size, not by its first cell", () => {
    expect(blockLabel({ kind: "table", columns: ["id"], rows: [["a"], ["b"]] })).toBe("2 rows");
    expect(blockLabel({ kind: "table", columns: ["id"], rows: [["a"]] })).toBe("1 row");
  });

  it("takes the first line of a block of text", () => {
    expect(blockLabel({ kind: "text", text: "Reconciling 42 accounts\nagainst the June ledger" })).toBe("Reconciling 42 accounts");
  });

  it("names an ask by the question it asked", () => {
    expect(blockLabel({ kind: "ask", question: "Which ledger?", answerType: "str" })).toBe("Which ledger?");
  });

  // The verb is a question only while it still is one.
  it("names a held call by what became of it", () => {
    const held: Block = { kind: "approve", method: "Shows.CreateShow", request: "{}" };
    expect(blockLabel(held)).toBe("Approve Shows.CreateShow");
    expect(blockLabel({ ...held, decision: "approved" })).toBe("Shows.CreateShow approved");
    expect(blockLabel({ ...held, decision: "rejected" })).toBe("Shows.CreateShow not approved");
  });
});

describe("formatCell", () => {
  it("keeps a scalar as itself", () => {
    expect(formatCell("matched")).toBe("matched");
    expect(formatCell(41.2)).toBe("41.2");
    expect(formatCell(false)).toBe("false");
  });

  // A column that is sometimes a value and sometimes "[object Object]" is worse
  // than one that is always readable.
  it("never lets a cell land as [object Object]", () => {
    expect(formatCell({ short: 41.2 })).toBe('{"short":41.2}');
  });

  it("shows an absent cell as empty rather than as the word for absent", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
  });

  // Anywhere but a cell there is nowhere to go, so what is left of a destination
  // is what it would have been drawn as.
  it("reads a destination as its label", () => {
    expect(formatCell(new RunCell("Refund", { script: "orders/refund" }))).toBe("Refund");
  });
});

// The destinations, on the same rules the statuses beside them follow: sparse at
// both levels, a new object at each, and absent rather than empty.
describe("withCellRun", () => {
  const table: TableBlock = { kind: "table", columns: ["id", ""], rows: [["1", "detail"]] };

  it("sets one cell without touching the block it came from", () => {
    const runs = withCellRun(table, 0, 1, { script: "detail" });
    expect(runs).toEqual({ 0: { 1: { script: "detail" } } });
    expect(table.runs).toBeUndefined();
  });

  it("hands back a new object down the path it wrote", () => {
    const first = withCellRun(table, 0, 1, { script: "detail" });
    const second = withCellRun({ ...table, runs: first }, 0, 0, { script: "audit" });
    expect(second).not.toBe(first);
    expect(second?.[0]).not.toBe(first?.[0]);
    expect(cellRun({ ...table, runs: second }, 0, 1)).toEqual({ script: "detail" });
    expect(cellRun({ ...table, runs: second }, 0, 0)).toEqual({ script: "audit" });
  });

  it("drops the map with the last row that had one", () => {
    const runs = withCellRun(table, 0, 1, { script: "detail" });
    expect(withoutRowRuns({ ...table, runs }, 0)).toBeUndefined();
    expect(withoutRowRuns({ ...table, runs }, 1)).toBe(runs);
  });
});
