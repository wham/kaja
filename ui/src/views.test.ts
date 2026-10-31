import { describe, expect, it } from "bun:test";
import {
  dropView,
  restoreViews,
  serializeViews,
  showAppForm,
  setAppFormType,
  showDefinition,
  showMcp,
  showShortcuts,
  showVariables,
  startView,
  View,
  viewIdentity,
  visit,
} from "./views";
import { buildApp } from "./appTypes";

// Views carry Monaco models in the app; here they are stubs, so they are built
// by hand rather than through the openers that create models.
function view(id: string, seq: number): View {
  return { type: "shortcuts", id, seq };
}

function draftView(id: string, draftId: string): View {
  return { type: "draft", id, seq: 1, draftId, model: {} as any };
}

describe("visit", () => {
  it("brings a view to the front, which is the only way one becomes current", () => {
    const views = [view("a", 1), view("b", 2), view("c", 3)];
    expect(visit(views, "c").map((v) => v.id)).toEqual(["c", "a", "b"]);
  });

  it("leaves the list alone when the view is already current or unknown", () => {
    const views = [view("a", 1), view("b", 2)];
    expect(visit(views, "a")).toBe(views);
    expect(visit(views, "gone")).toBe(views);
  });
});

describe("the mounted cache", () => {
  const grpcApp = (name: string) => buildApp(name, "grpc", { url: "example.com:443" }, {});

  it("keeps at most ten views, dropping the least recently visited", () => {
    let views: View[] = [];
    for (let i = 0; i < 14; i++) views = showShortcuts(dropView(views, views.find((v) => v.type === "shortcuts")?.id ?? ""));
    expect(views.length).toBeLessThanOrEqual(10);
  });

  // A form holds edits that exist nowhere else, so it is never the one evicted.
  it("never evicts a view holding work", () => {
    let views = showVariables([]);
    const variablesId = views[0].id;
    for (let i = 0; i < 15; i++) {
      views = showAppForm(views, "edit", grpcApp(`app-${i}`));
    }
    expect(views.some((v) => v.id === variablesId)).toBe(true);
  });

  it("goes back to a surface it already has instead of mounting a second one", () => {
    const once = showShortcuts(showVariables([]));
    const twice = showShortcuts(showVariables(once));

    expect(twice).toHaveLength(2);
    expect(twice[0].type).toBe("shortcuts");
  });

  it("names an app's settings after the app, and a new one after its type", () => {
    expect(viewIdentity(showAppForm([], "edit", grpcApp("orders"))[0]).name).toBe("orders");
    expect(viewIdentity(showAppForm([], "create", buildApp("", "openapi", {}, {}))[0]).name).toBe("New OpenAPI app");
  });

  it("starts a new app over when another type is picked", () => {
    const mcp = showAppForm([], "create", buildApp("", "mcp", { url: "https://example.com/mcp" }, {}));
    const openapi = showAppForm(mcp, "create", buildApp("", "openapi", {}, {}));

    expect(openapi).toHaveLength(1);
    expect(viewIdentity(openapi[0]).name).toBe("New OpenAPI app");
  });

  it("goes back to a new app already started rather than starting another", () => {
    const started = showAppForm(showAppForm([], "create"), "create", buildApp("", "mcp", { url: "https://example.com/mcp" }, {}));
    const again = showAppForm(started, "create");

    expect(again).toHaveLength(1);
    expect(again[0].type === "appForm" && again[0].initialData).toEqual(started[0].type === "appForm" && started[0].initialData);
  });

  it("names a new app for the type picked in its form, and asks again with none", () => {
    const blank = showAppForm([], "create");
    expect(viewIdentity(blank[0]).name).toBe("New app");

    const picked = setAppFormType(blank, blank[0].id, "openapi");
    expect(viewIdentity(picked[0]).name).toBe("New OpenAPI app");
    expect(viewIdentity(setAppFormType(picked, blank[0].id, "")[0]).name).toBe("New app");
  });
});

describe("the MCP view", () => {
  // It saves as it goes, so there is nothing on it to protect from eviction — which
  // is the whole of what makes it unlike the variables beside it in the band.
  it("is one page the band goes back to, and the cache may let it go", () => {
    const once = showMcp([]);
    expect(showMcp(once)).toHaveLength(1);
    expect(viewIdentity(once[0]).name).toBe("MCP server");
    expect(viewIdentity(once[0]).path).toBe("Settings");

    let views = once;
    for (let i = 0; i < 15; i++) views = showAppForm(views, "edit", buildApp(`app-${i}`, "grpc", { url: "example.com:443" }, {}));
    expect(views.some((v) => v.type === "mcp")).toBe(false);
  });
});

describe("Start", () => {
  // It is what the window opens on, and what "back" reaches when nothing else is
  // underneath — so a restore that recovered nothing still has a view.
  it("is the bottom of every restored stack", () => {
    expect(restoreViews(undefined, []).map((v) => v.type)).toEqual(["start"]);
    expect(viewIdentity(startView()).name).toBe("Start");
  });

  it("is never evicted and never costs a real view its place", () => {
    let views: View[] = [startView()];
    for (let i = 0; i < 15; i++) views = showDefinition(views, {} as any, 1, 1);

    expect(views[views.length - 1].type).toBe("start");
    expect(views.filter((v) => v.type !== "start")).toHaveLength(10);
  });

  it("comes to the front like anything else, and falls back down again", () => {
    const views = showVariables([startView()]);
    const start = views.find((v) => v.type === "start")!;

    expect(visit(views, start.id)[0].type).toBe("start");
    expect(showMcp(visit(views, start.id)).map((v) => v.type)).toEqual(["mcp", "start", "variables"]);
  });

  // Recreated on launch by definition, so there is nothing about it to store.
  it("is not persisted", () => {
    expect(serializeViews([startView()], () => undefined).views).toEqual([]);
  });
});

describe("viewIdentity", () => {
  it("takes a draft's name from the store, so the two can't drift apart", () => {
    const draft = { id: "s1", title: "Get · wham/kaja", originAppName: "github" } as any;
    const identity = viewIdentity(draftView("draft-1", "s1"), [draft]);

    expect(identity.name).toBe("Get wham/kaja");
    expect(identity.path).toBe("Drafts");
    expect(identity.origin).toBe("github");
  });
});

describe("serializeViews", () => {
  it("stores which draft a view shows, never its code", () => {
    const views: View[] = [draftView("draft-1", "s1")];
    const result = serializeViews(views, () => undefined);

    expect(result.views).toEqual([{ type: "draft", draftId: "s1", viewState: undefined }]);
  });

  it("skips the compile log an older build stored", () => {
    expect(restoreViews({ views: [{ type: "compiler" } as any] }, []).map((v) => v.type)).toEqual(["start"]);
  });

  it("uses live editor view state over stored view state", () => {
    const live = { cursorState: [{ position: { lineNumber: 5 } }] } as any;
    expect((serializeViews([draftView("draft-1", "s1")], () => live).views[0] as any).viewState).toBe(live);
  });
});
