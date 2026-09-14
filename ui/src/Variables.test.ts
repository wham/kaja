import { describe, expect, it } from "bun:test";
import { shouldAdoptIncomingVariables } from "./Variables";

describe("shouldAdoptIncomingVariables", () => {
  it("adopts an external update when the table still matches the previous configuration", () => {
    expect(shouldAdoptIncomingVariables({ A: "old" }, { A: "old" }, { A: "external" }, { A: "saved" }, true)).toBe(true);
  });

  it("keeps a newer edit when an earlier autosave is acknowledged", () => {
    expect(shouldAdoptIncomingVariables({ A: "old" }, { A: "old" }, { A: "saved" }, { A: "saved" }, true)).toBe(false);
  });

  it("adopts the acknowledged save when nothing was edited after it started", () => {
    expect(shouldAdoptIncomingVariables({ A: "saved" }, { A: "old" }, { A: "saved" }, { A: "saved" }, false)).toBe(false);
  });

  // The watcher sends the file back after every save, so the table is told its own
  // content a moment after writing it. Adopting that re-sorts the rows.
  it("keeps the table's order when the push carries what it already holds", () => {
    expect(shouldAdoptIncomingVariables({ A: "1", B: "2" }, { A: "1", B: "2" }, { A: "1", B: "2" }, undefined, false)).toBe(false);
  });

  it("keeps a row being added when the push carries what the table already holds", () => {
    expect(shouldAdoptIncomingVariables({ A: "1" }, { A: "1" }, { A: "1" }, undefined, false)).toBe(false);
  });
});
