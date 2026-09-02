import { describe, expect, it } from "bun:test";
import {
  dropView,
  restoreViews,
  serializeViews,
  setAppFormEditMode,
  showAppForm,
  showCompiler,
  showMcp,
  showVariables,
  View,
  viewIdentity,
  visit,
} from "./views";
import { buildApp } from "./appTypes";

// Views carry Monaco models in the app; here they are stubs, so they are built
// by hand rather than through the openers that create models.
function view(id: string, seq: number): View {
  return { type: "compiler", id, seq };
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
    for (let i = 0; i < 14; i++) views = showCompiler(dropView(views, views.find((v) => v.type === "compiler")?.id ?? ""));
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
    const once = showCompiler(showVariables([]));
    const twice = showCompiler(showVariables(once));

    expect(twice).toHaveLength(2);
    expect(twice[0].type).toBe("compiler");
  });

  it("names an app's settings after the app, and a new one after its type", () => {
    expect(viewIdentity(showAppForm([], "edit", grpcApp("orders"))[0]).name).toBe("orders");
    expect(viewIdentity(showAppForm([], "create", buildApp("", "openapi", {}, {}))[0]).name).toBe("New OpenAPI app");
  });

  it("remembers which view of the app is showing", () => {
    const views = showAppForm([], "edit", grpcApp("orders"));
    expect((setAppFormEditMode(views, views[0].id, "json")[0] as any).editMode).toBe("json");
  });
});

describe("the MCP view", () => {
  // It saves as it goes, so there is nothing on it to protect from eviction — which
  // is the whole of what makes it unlike the variables beside it in the band.
  it("is one page the band goes back to, and the cache may let it go", () => {
    const once = showMcp([]);
    expect(showMcp(once)).toHaveLength(1);
    expect(viewIdentity(once[0]).name).toBe("MCP server");
    expect(viewIdentity(once[0]).path).toBe("Workspace");

    let views = once;
    for (let i = 0; i < 15; i++) views = showAppForm(views, "edit", buildApp(`app-${i}`, "grpc", { url: "example.com:443" }, {}));
    expect(views.some((v) => v.type === "mcp")).toBe(false);
  });
});

describe("viewIdentity", () => {
  it("takes a draft's name from the store, so the two can't drift apart", () => {
    const draft = { id: "s1", title: "GetShow · vera-lune", originAppName: "theatre" } as any;
    const identity = viewIdentity(draftView("draft-1", "s1"), [draft]);

    expect(identity.name).toBe("GetShow · vera-lune");
    expect(identity.path).toBe("Drafts");
    expect(identity.origin).toBe("theatre");
  });
});

describe("serializeViews", () => {
  it("stores which draft a view shows, never its code", () => {
    const views: View[] = [draftView("draft-1", "s1")];
    const result = serializeViews(views, () => undefined);

    expect(result.views).toEqual([{ type: "draft", draftId: "s1", viewState: undefined }]);
  });

  // The log reports on this session's apps, so it is not somewhere kaja can
  // start: it is left out on the way down, and skipped on the way back up when
  // an older build wrote one.
  it("leaves the compile log out, and doesn't restore a stored one", () => {
    const views: View[] = [view("compiler-1", 1), draftView("draft-1", "s1")];
    expect(serializeViews(views, () => undefined).views).toEqual([{ type: "draft", draftId: "s1", viewState: undefined }]);

    expect(restoreViews({ views: [{ type: "compiler" } as any] }, [])).toEqual([]);
  });

  it("uses live editor view state over stored view state", () => {
    const live = { cursorState: [{ position: { lineNumber: 5 } }] } as any;
    expect((serializeViews([draftView("draft-1", "s1")], () => live).views[0] as any).viewState).toBe(live);
  });
});
