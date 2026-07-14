import { describe, expect, it } from "bun:test";
import { getTabLabel, linkTabsToApps, serializeTabs, TabModel } from "./tabModel";
import { App } from "./apps";

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
  it("should serialize task and compiler tabs, skipping definition and appForm tabs", () => {
    const tabs: TabModel[] = [
      { type: "compiler" },
      {
        type: "task",
        id: "task-1",
        originMethod: { name: "GetUser" },
        originService: { name: "UserService", packageName: "users.v1", sourcePath: "", clientStubModuleId: "", methods: [] },
        originApp: { configuration: { name: "users" } } as any,
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
      appName: "users",
      serviceName: "UserService",
      methodName: "GetUser",
      code: "some code",
      originalCode: "original code",
      hasInteraction: true,
      viewState: { cursorState: [] },
    });
  });

  it("should adjust active index when non-serialized tabs are before the active tab", () => {
    const tabs: TabModel[] = [{ type: "definition", id: "def-1", model: {} as any, startLineNumber: 1, startColumn: 1 }, { type: "compiler" }];

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
        originApp: { configuration: { name: "p" } } as any,
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

describe("linkTabsToApps", () => {
  function taskTab(id: string, appName: string, serviceName: string, methodName: string): TabModel {
    let disposed = false;
    return {
      type: "task",
      id,
      originMethod: { name: methodName },
      originService: { name: serviceName, packageName: "", sourcePath: "", clientStubModuleId: "", methods: [{ name: methodName }] },
      originApp: { configuration: { name: appName } } as any,
      hasInteraction: false,
      model: { dispose: () => (disposed = true), isDisposed: () => disposed } as any,
      originalCode: "",
    };
  }

  function app(name: string, serviceName: string, methodName: string): App {
    const service = { name: serviceName, packageName: "", sourcePath: "", clientStubModuleId: "", methods: [{ name: methodName }] };
    return { configuration: { name }, services: [service] } as any;
  }

  it("re-binds a task tab to the matching compiled app by identity", () => {
    const tab = taskTab("task-1", "users", "UserService", "GetUser");
    const compiled = app("users", "UserService", "GetUser");

    const result = linkTabsToApps([tab], [compiled]);

    expect(result.tabs).toHaveLength(1);
    expect(result.removedTabIds).toHaveLength(0);
    expect((result.tabs[0] as any).originApp).toBe(compiled);
    expect((result.tabs[0] as any).originService).toBe(compiled.services[0]);
  });

  it("drops and disposes a task tab whose app was deleted", () => {
    const tab = taskTab("task-1", "teams", "Teams", "GetAllTeams");

    const result = linkTabsToApps([tab], [app("users", "UserService", "GetUser")]);

    expect(result.tabs).toHaveLength(0);
    expect(result.removedTabIds).toEqual(["task-1"]);
    expect((tab as any).model.isDisposed()).toBe(true);
  });

  it("drops a task tab whose service or method no longer exists", () => {
    const goneMethod = taskTab("task-1", "users", "UserService", "RemovedMethod");
    const goneService = taskTab("task-2", "users", "RemovedService", "GetUser");
    const kept = taskTab("task-3", "users", "UserService", "GetUser");

    const result = linkTabsToApps([goneMethod, goneService, kept], [app("users", "UserService", "GetUser")]);

    expect(result.tabs.map((t) => (t as any).id)).toEqual(["task-3"]);
    expect(result.removedTabIds).toEqual(["task-1", "task-2"]);
  });

  it("keeps non-task tabs untouched", () => {
    const compilerTab: TabModel = { type: "compiler" };
    const result = linkTabsToApps([compilerTab], []);

    expect(result.tabs).toEqual([compilerTab]);
    expect(result.removedTabIds).toHaveLength(0);
  });
});
