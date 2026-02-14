import { describe, expect, it } from "vitest";
import { getTabLabel, serializeTabs, TabModel } from "./tabModel";

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

describe("serializeTabs", () => {
  it("should serialize task and compiler tabs, skipping definition and projectForm tabs", () => {
    const tabs: TabModel[] = [
      { type: "compiler" },
      {
        type: "task",
        id: "task-1",
        originMethod: { name: "GetUser" },
        originService: { name: "UserService", packageName: "users.v1", sourcePath: "", clientStubModuleId: "", methods: [] },
        originProject: { configuration: { name: "users" } } as any,
        hasInteraction: true,
        model: { getValue: () => "some code" } as any,
        originalCode: "original code",
        viewState: { cursorState: [] } as any,
      },
      {
        type: "definition",
        id: "def-1",
        model: {} as any,
        startLineNumber: 10,
        startColumn: 5,
      },
    ];

    const result = serializeTabs(tabs, 1, () => undefined);

    expect(result.tabs).toHaveLength(2);
    expect(result.activeIndex).toBe(1);
    expect(result.tabs[0]).toEqual({ type: "compiler" });
    expect(result.tabs[1]).toEqual({
      type: "task",
      projectName: "users",
      serviceName: "UserService",
      methodName: "GetUser",
      code: "some code",
      originalCode: "original code",
      hasInteraction: true,
      viewState: { cursorState: [] },
    });
  });

  it("should adjust active index when non-serialized tabs are before the active tab", () => {
    const tabs: TabModel[] = [
      { type: "definition", id: "def-1", model: {} as any, startLineNumber: 1, startColumn: 1 },
      { type: "compiler" },
    ];

    const result = serializeTabs(tabs, 1, () => undefined);
    expect(result.activeIndex).toBe(0);
    expect(result.tabs).toHaveLength(1);
  });

  it("should use live editor view state over stored view state", () => {
    const liveViewState = { cursorState: [{ position: { lineNumber: 5 } }] } as any;
    const tabs: TabModel[] = [
      {
        type: "task",
        id: "task-1",
        originMethod: { name: "M" },
        originService: { name: "S", packageName: "", sourcePath: "", clientStubModuleId: "", methods: [] },
        originProject: { configuration: { name: "p" } } as any,
        hasInteraction: false,
        model: { getValue: () => "" } as any,
        originalCode: "",
        viewState: { cursorState: [{ position: { lineNumber: 1 } }] } as any,
      },
    ];

    const result = serializeTabs(tabs, 0, () => liveViewState);
    expect((result.tabs[0] as any).viewState).toBe(liveViewState);
  });
});
