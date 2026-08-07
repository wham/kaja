import { describe, expect, it } from "bun:test";
import {
  activateTab,
  AppFormTab,
  closeTab,
  keepTab,
  openAppFormTab,
  openCompilerTab,
  openVariablesTab,
  serializeTabs,
  setAppFormEditMode,
  tabIdentity,
  TabModel,
} from "./tabModel";
import { buildApp } from "./appTypes";

// The open files carry Monaco models in the app; here they are stubs, so the
// tabs are built by hand rather than through the openers that create models.
function tab(id: string, seq: number, preview = false): TabModel {
  return { type: "compiler", id, seq, preview };
}

function scratchTab(id: string, scratchId: string): TabModel {
  return { type: "scratch", id, seq: 1, preview: false, scratchId, model: {} as any };
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
  it("takes a scratch's name from the store, so the two can't drift apart", () => {
    const scratch = { id: "s1", title: "GetShow · vera-lune", origin: { appName: "theatre", serviceName: "TheKajaTheatre", methodName: "GetShow" } } as any;
    const identity = tabIdentity(scratchTab("scratch-1", "s1"), [scratch]);

    expect(identity.name).toBe("GetShow · vera-lune");
    expect(identity.path).toBe("Scripts");
    expect(identity.origin).toBe("theatre");
  });
});

describe("serializeTabs", () => {
  it("stores which scratch a tab shows, never its code", () => {
    const tabs: TabModel[] = [
      tab("compiler-1", 1),
      scratchTab("scratch-1", "s1"),
      { type: "definition", id: "def-1", seq: 3, preview: true, model: {} as any, startLineNumber: 10, startColumn: 5 },
    ];

    const result = serializeTabs(tabs, () => undefined);

    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0]).toEqual({ type: "compiler", preview: false });
    expect(result.tabs[1]).toEqual({ type: "scratch", preview: false, scratchId: "s1", viewState: undefined });
  });

  it("uses live editor view state over stored view state", () => {
    const liveViewState = { cursorState: [{ position: { lineNumber: 5 } }] } as any;
    const result = serializeTabs([scratchTab("scratch-1", "s1")], () => liveViewState);

    expect((result.tabs[0] as any).viewState).toBe(liveViewState);
  });
});
