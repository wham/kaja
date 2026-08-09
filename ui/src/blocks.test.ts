import { describe, expect, it } from "bun:test";
import { Block, blockLabel, blockText, formatCell, isAwaitingUser } from "./blocks";

describe("isAwaitingUser", () => {
  it("is true only for a question nobody has answered", () => {
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?" })).toBe(true);
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?", answer: "june" })).toBe(false);
  });

  // A cancelled ask stopped the script rather than parking it, so the run is
  // over — showing it as waiting would offer an input nothing is listening to.
  it("is false for a question that was cancelled", () => {
    expect(isAwaitingUser({ kind: "ask", question: "Which ledger?", cancelled: true })).toBe(false);
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
    expect(blockLabel({ kind: "ask", question: "Which ledger?" })).toBe("Which ledger?");
  });

  // The verb is a question only while it still is one.
  it("names a held call by what became of it", () => {
    const held: Block = { kind: "approve", method: "Shows.CreateShow", request: "{}" };
    expect(blockLabel(held)).toBe("Approve Shows.CreateShow");
    expect(blockLabel({ ...held, decision: "approved" })).toBe("Shows.CreateShow approved");
    expect(blockLabel({ ...held, decision: "rejected" })).toBe("Shows.CreateShow not approved");
  });
});

describe("blockText", () => {
  // The copy button hands out something pasteable, so a table leaves as its own
  // rows rather than as a drawing of them.
  it("copies a table as its columns and rows", () => {
    const table: Block = { kind: "table", columns: ["id", "status"], rows: [["ac_1", "matched"]] };
    expect(blockText(table)).toBe("id\tstatus\nac_1\tmatched");
  });

  it("copies a question with what it was answered", () => {
    expect(blockText({ kind: "ask", question: "Which ledger?", answer: "june" })).toBe("Which ledger?\njune");
  });

  it("copies a held call with the request it was holding", () => {
    const held: Block = { kind: "approve", method: "Shows.CreateShow", request: '{ "title": "Vera Lune" }', decision: "approved" };
    expect(blockText(held)).toBe('Shows.CreateShow approved\n{ "title": "Vera Lune" }');
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
});
