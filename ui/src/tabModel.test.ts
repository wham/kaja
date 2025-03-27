import * as monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import { getTabLabel } from "./tabModel";

describe("getTabLabel", () => {
  it("should return just the filename from a path", () => {
    const model = monaco.editor.createModel("", "typescript", monaco.Uri.parse("ts:/grpc/web/code.ts"));
    const tab = { type: "definition" as const, id: "test-id", model };

    expect(getTabLabel(tab)).toBe("code.ts");
  });

  it("should handle paths with no slashes", () => {
    const model = monaco.editor.createModel("", "typescript", monaco.Uri.parse("ts:/simple.ts"));
    const tab = { type: "definition" as const, id: "test-id", model };

    expect(getTabLabel(tab)).toBe("simple.ts");
  });

  it("should handle paths with multiple slashes", () => {
    const model = monaco.editor.createModel("", "typescript", monaco.Uri.parse("ts:/a/b/c/d/file.ts"));
    const tab = { type: "definition" as const, id: "test-id", model };

    expect(getTabLabel(tab)).toBe("file.ts");
  });
});
