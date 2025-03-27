import { describe, expect, it } from "vitest";
import { getTabLabel } from "./tabModel";

describe("getTabLabel", () => {
  it("should return just the filename from a path", () => {
    expect(getTabLabel("ts:/grpc/web/code.ts")).toBe("code.ts");
  });

  it("should handle paths with no slashes", () => {
    expect(getTabLabel("ts:/simple.ts")).toBe("simple.ts");
  });

  it("should handle paths with multiple slashes", () => {
    expect(getTabLabel("ts:/a/b/c/d/file.ts")).toBe("file.ts");
  });
});
