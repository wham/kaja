import { describe, expect, it } from "bun:test";
import { isNewGeneration, retryDelay } from "./workspaceLoad";

describe("isNewGeneration", () => {
  it("applies the stream's opening message only where the window has not heard it", () => {
    expect(isNewGeneration("g1", "g1")).toBe(false);
    expect(isNewGeneration("g1", "g2")).toBe(true);
  });

  it("applies the first message a window with nothing yet is handed", () => {
    expect(isNewGeneration(undefined, "g1")).toBe(true);
  });

  it("always applies a message from a server that states no generation", () => {
    expect(isNewGeneration("", "")).toBe(true);
    expect(isNewGeneration("g1", "")).toBe(true);
  });
});

describe("retryDelay", () => {
  it("backs off and stops at the ceiling", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(3)).toBe(8000);
    expect(retryDelay(10)).toBe(15000);
  });
});
