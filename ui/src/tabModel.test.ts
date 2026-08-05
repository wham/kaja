import { describe, expect, it } from "bun:test";
import {
  activateTab,
  AppFormTab,
  closeTab,
  keepTab,
  linkTabsToApps,
  openAppFormTab,
  openCompilerTab,
  openVariablesTab,
  serializeTabs,
  setAppFormEditMode,
  tabIdentity,
  TabModel,
} from "./tabModel";
import { buildApp } from "./appTypes";
import { App } from "./apps";

// The open files carry Monaco models in the app; here they are stubs, so the
// tabs are built by hand rather than through the openers that create models.
function tab(id: string, seq: number, preview = false): TabModel {
  return { type: "compiler", id, seq, preview };
}

function taskTab(id: string, appName: string, serviceName: string, methodName: string): TabModel {
  let disposed = false;
  return {
    type: "task",
    id,
    seq: 1,
    preview: false,
    originMethod: { name: methodName },
    originService: { name: serviceName, packageName: "", sourcePath: "", clientStubModuleId: "", methods: [{ name: methodName }] },
    originApp: { configuration: { name: appName } } as any,
    model: { dispose: () => (disposed = true), isDisposed: () => disposed, getValue: () => "code" } as any,
    originalCode: "original",
  };
}

describe("activateTab", () => {
  it("brings a tab to the front, which is the only way one becomes current", () => {
    const tabs = [tab("a", 1), tab("b", 2), tab("c", 3)];
    expect(activateTab(tabs, "c").map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("leaves the list alone when the tab is already current or unknown", () => {
    const tabs = [tab("a", 1), tab("b", 2)];
    expect(activateTab(tabs, "a")).toBe(tabs);
    expect(activateTab(tabs, "gone")).toBe(tabs);
  });
});

describe("closeTab", () => {
  it("falls through to the most recently visited file, not a neighbour", () => {
    const tabs = [tab("a", 1), tab("b", 2), tab("c", 3)];
    expect(closeTab(tabs, "a").map((t) => t.id)).toEqual(["b", "c"]);
  });
});

describe("preview", () => {
  const grpcApp = (name: string) => buildApp(name, "grpc", { url: "example.com:443" }, {});

  it("opens an app's settings as a preview named after the app", () => {
    const tabs = openAppFormTab([tab("a", 1)], "edit", grpcApp("orders"));

    expect(tabs).toHaveLength(2);
    expect(tabs[0].preview).toBe(true);
    expect(tabIdentity(tabs[0]).name).toBe("orders");
    expect((tabs[0] as AppFormTab).editMode).toBe("form");
  });

  it("names a new app after its type until it is saved", () => {
    const tabs = openAppFormTab([], "create", buildApp("", "openapi", {}, {}));
    expect(tabIdentity(tabs[0]).name).toBe("New OpenAPI app");
  });

  // One preview slot for the whole pane: browsing never stacks tabs.
  it("takes the preview slot from whatever was in it", () => {
    const first = openAppFormTab([], "edit", grpcApp("orders"));
    const second = openAppFormTab(first, "edit", grpcApp("billing"));

    expect(second).toHaveLength(1);
    expect((second[0] as AppFormTab).editingAppName).toBe("billing");
  });

  it("leaves a tab that is being worked in alone and opens another", () => {
    const first = openAppFormTab([], "edit", grpcApp("orders"));
    const kept = keepTab(first, first[0].id);
    const second = openAppFormTab(kept, "edit", grpcApp("billing"));

    expect(second).toHaveLength(2);
    expect((second[0] as AppFormTab).editingAppName).toBe("billing");
    expect((second[1] as AppFormTab).editingAppName).toBe("orders");
  });

  it("brings the app's own tab to the front when it is already open", () => {
    const orders = openAppFormTab([], "edit", grpcApp("orders"));
    const both = openAppFormTab(keepTab(orders, orders[0].id), "edit", grpcApp("billing"));
    const again = openAppFormTab(both, "edit", grpcApp("orders"));

    expect(again).toHaveLength(2);
    expect((again[0] as AppFormTab).editingAppName).toBe("orders");
  });

  it("remembers which view of the app the tab is showing", () => {
    const tabs = openAppFormTab([], "edit", grpcApp("orders"));
    expect((setAppFormEditMode(tabs, tabs[0].id, "json")[0] as AppFormTab).editMode).toBe("json");
  });

  it("keeps the singleton surfaces to one tab each", () => {
    const once = openCompilerTab(openVariablesTab([]));
    const twice = openCompilerTab(openVariablesTab(once));

    expect(twice).toHaveLength(2);
    expect(twice[0].type).toBe("compiler");
  });
});

describe("tabIdentity", () => {
  it("names a call by its method and places it under its app and service", () => {
    const identity = tabIdentity(taskTab("task-1", "users", "UserService", "GetUser"));

    expect(identity.name).toBe("GetUser");
    expect(identity.path).toBe("users / UserService");
    expect(identity.origin).toBe("users");
  });
});

describe("serializeTabs", () => {
  it("serializes task and compiler tabs in visit order, skipping the rest", () => {
    const tabs: TabModel[] = [
      tab("compiler-1", 1),
      taskTab("task-1", "users", "UserService", "GetUser"),
      { type: "definition", id: "def-1", seq: 3, preview: true, model: {} as any, startLineNumber: 10, startColumn: 5 },
    ];

    const result = serializeTabs(tabs, () => undefined);

    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0]).toEqual({ type: "compiler", preview: false });
    expect(result.tabs[1]).toEqual({
      type: "task",
      preview: false,
      appName: "users",
      serviceName: "UserService",
      methodName: "GetUser",
      code: "code",
      originalCode: "original",
      viewState: undefined,
    });
  });

  it("uses live editor view state over stored view state", () => {
    const liveViewState = { cursorState: [{ position: { lineNumber: 5 } }] } as any;
    const tabs = [taskTab("task-1", "p", "S", "M")];

    const result = serializeTabs(tabs, () => liveViewState);
    expect((result.tabs[0] as any).viewState).toBe(liveViewState);
  });
});

describe("linkTabsToApps", () => {
  function app(name: string, serviceName: string, methodName: string): App {
    const service = { name: serviceName, packageName: "", sourcePath: "", clientStubModuleId: "", methods: [{ name: methodName }] };
    return { configuration: { name }, services: [service] } as any;
  }

  it("re-binds a task tab to the matching compiled app by identity", () => {
    const compiled = app("users", "UserService", "GetUser");
    const tabs = linkTabsToApps([taskTab("task-1", "users", "UserService", "GetUser")], [compiled]);

    expect(tabs).toHaveLength(1);
    expect((tabs[0] as any).originApp).toBe(compiled);
    expect((tabs[0] as any).originService).toBe(compiled.services[0]);
  });

  it("drops a task tab whose app, service or method no longer exists", () => {
    const goneApp = taskTab("task-1", "teams", "Teams", "GetAllTeams");
    const goneMethod = taskTab("task-2", "users", "UserService", "RemovedMethod");
    const kept = taskTab("task-3", "users", "UserService", "GetUser");

    const tabs = linkTabsToApps([goneApp, goneMethod, kept], [app("users", "UserService", "GetUser")]);

    expect(tabs.map((t) => t.id)).toEqual(["task-3"]);
  });

  it("keeps non-task tabs untouched", () => {
    const compilerTab = tab("compiler-1", 1);
    expect(linkTabsToApps([compilerTab], [])).toEqual([compilerTab]);
  });
});
