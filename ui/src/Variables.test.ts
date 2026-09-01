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
});
