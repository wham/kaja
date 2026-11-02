import { describe, expect, it } from "bun:test";
import { shouldAdoptIncomingVariables, storedValueChanges } from "./Variables";

describe("shouldAdoptIncomingVariables", () => {
  it("adopts an external update when the table still matches the previous workspace", () => {
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

describe("storedValueChanges", () => {
  const secret = "${secret}";

  it("carries a renamed stored value instead of clearing it", () => {
    expect(storedValueChanges({ A: secret }, { B: secret }, [{ saved: "A", key: "B" }], new Set())).toEqual({ renamed: [{ from: "A", to: "B" }], cleared: [] });
  });

  it("carries a sign-in the same way", () => {
    expect(storedValueChanges({ A: "${signin}" }, { B: "${signin}" }, [{ saved: "A", key: " B " }], new Set())).toEqual({
      renamed: [{ from: "A", to: "B" }],
      cleared: [],
    });
  });

  it("clears a value whose row changed source as well as name", () => {
    expect(storedValueChanges({ A: secret }, { B: "plain" }, [{ saved: "A", key: "B" }], new Set())).toEqual({ renamed: [], cleared: ["A"] });
  });

  it("does not move a value onto a name the file already had", () => {
    expect(storedValueChanges({ A: secret, B: secret }, { B: secret }, [{ saved: "A", key: "B" }], new Set())).toEqual({ renamed: [], cleared: ["A"] });
  });

  it("clears a deleted value unless told to keep it", () => {
    expect(storedValueChanges({ A: secret }, {}, [], new Set())).toEqual({ renamed: [], cleared: ["A"] });
    expect(storedValueChanges({ A: secret }, {}, [], new Set(["A"]))).toEqual({ renamed: [], cleared: [] });
  });

  it("leaves a row that was never saved alone", () => {
    expect(storedValueChanges({}, { B: secret }, [{ key: "B" }], new Set())).toEqual({ renamed: [], cleared: [] });
  });
});
