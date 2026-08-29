import { describe, expect, it } from "bun:test";
import {
  appendCall,
  createDraft,
  editedDrafts,
  findUntouched,
  isUntouched,
  markRun,
  orderDrafts,
  pruneDrafts,
  reopen,
  Draft,
  takeOver,
  untouchedDrafts,
  withCode,
} from "./drafts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const listShows = `import { TheKajaTheatre } from "theatre/service";\n\nTheKajaTheatre.ListShows({});\n`;
const getShow = `import { TheKajaTheatre } from "theatre/service";\n\nTheKajaTheatre.GetShow({ id: "" });\n`;
const getSeatMap = `import { Seating } from "seating/service";\n\nSeating.GetSeatMap({});\n`;

describe("createDraft", () => {
  it("names itself from the code it was born with", () => {
    expect(createDraft(listShows, undefined, NOW).title).toBe("ListShows");
  });

  it("falls back when the code calls nothing", () => {
    expect(createDraft("// empty", undefined, NOW).title).toBe("Draft");
  });
});

describe("isUntouched", () => {
  it("is true only while the code is still what was generated and nothing has run", () => {
    const draft = createDraft(listShows, undefined, NOW);
    expect(isUntouched(draft)).toBe(true);
    expect(isUntouched({ ...draft, code: listShows + "// mine" })).toBe(false);
    expect(isUntouched({ ...draft, ran: true })).toBe(false);
  });
});

describe("findUntouched", () => {
  const buffer = (code: string, originAppName?: string, extra: Partial<Draft> = {}) => ({
    ...createDraft(code, originAppName, NOW),
    ...extra,
  });

  it("finds the browsing buffer that already holds the call", () => {
    const held = buffer(listShows, "theatre");
    expect(findUntouched([buffer(getShow, "theatre"), held], listShows, "theatre")?.id).toBe(held.id);
  });

  it("takes the most recent of several", () => {
    const [newest, oldest] = [buffer(listShows, "theatre"), buffer(listShows, "theatre")];
    expect(findUntouched([newest, oldest], listShows, "theatre")?.id).toBe(newest.id);
  });

  it("never reaches a draft that was worked in", () => {
    expect(findUntouched([buffer(listShows, "theatre", { ran: true })], listShows, "theatre")).toBeUndefined();
    expect(findUntouched([buffer(listShows, "theatre", { code: listShows + "// mine" })], listShows, "theatre")).toBeUndefined();
  });

  it("keeps two apps apart even when their code reads the same", () => {
    expect(findUntouched([buffer(getSeatMap, "seating")], getSeatMap, "theatre")).toBeUndefined();
  });
});

describe("reopen", () => {
  it("says the buffer is the one being browsed and settles nothing else", () => {
    const draft = createDraft(listShows, undefined, NOW);
    const held = reopen(draft, NOW + 1);

    expect(held.updatedAt).toBe(NOW + 1);
    expect(isUntouched(held)).toBe(true);
    expect(held.title).toBe(draft.title);
  });
});

describe("takeOver", () => {
  it("re-points a browsing buffer at another method and renames it", () => {
    const taken = takeOver(createDraft(listShows, undefined, NOW), getShow, undefined, NOW + 1);
    expect(taken.title).toBe("GetShow");
    expect(isUntouched(taken)).toBe(true);
  });
});

describe("markRun", () => {
  it("re-reads the title from the code as it stands at the run", () => {
    const draft = createDraft(getShow, undefined, NOW);
    const filled = getShow.replace('id: ""', 'id: "vera-lune"');
    const ran = markRun(draft, filled, NOW + 1);

    expect(ran.title).toBe("GetShow · vera-lune");
    expect(ran.ran).toBe(true);
  });
});

describe("withCode", () => {
  it("settles the title on an append, the way a run does", () => {
    const appended = withCode(createDraft(listShows, undefined, NOW), appendCall(listShows, getShow), NOW + 1);
    expect(appended.title).toBe("ListShows → GetShow");
  });
});

describe("pruneDrafts", () => {
  const stale = (id: string, extra: Partial<Draft> = {}): Draft => ({
    ...createDraft(listShows, undefined, NOW - 30 * DAY),
    id,
    updatedAt: NOW - 30 * DAY,
    ...extra,
  });

  it("drops old browsing buffers and keeps everything that was worked in", () => {
    const kept = pruneDrafts(
      [stale("browsed"), stale("ran", { ran: true }), stale("edited", { code: listShows + "// mine" }), createDraft(listShows, undefined, NOW)],
      NOW,
      new Set(),
    );

    expect(kept.map((draft) => draft.id)).toEqual(["ran", "edited", kept[2].id]);
  });

  it("never drops one that is open", () => {
    expect(pruneDrafts([stale("browsed")], NOW, new Set(["browsed"]))).toHaveLength(1);
  });

  // The agent's row persists with no client connected — that is how you read
  // what the last one did — so only a deliberate clear removes it.
  it("never sweeps the agent's draft", () => {
    expect(pruneDrafts([stale("agent", { agentClient: "Claude" })], NOW, new Set())).toHaveLength(1);
  });

  it("sweeps nothing while the sweep is off", () => {
    expect(pruneDrafts([stale("browsed")], NOW, new Set(), false)).toHaveLength(1);
  });
});

describe("the Drafts group", () => {
  const draft = (id: string, updatedAt: number, extra: Partial<Draft> = {}): Draft => ({
    ...createDraft(listShows, undefined, updatedAt),
    id,
    updatedAt,
    ...extra,
  });

  it("pins the agent's row first, then work, then the browsing buffers", () => {
    const ordered = orderDrafts([
      draft("browsed-old", NOW - 2 * DAY),
      draft("edited", NOW - 3 * DAY, { code: listShows + "// mine" }),
      draft("browsed-new", NOW),
      draft("agent", NOW - 9 * DAY, { agentClient: "Claude" }),
      draft("ran", NOW - DAY, { ran: true }),
    ]);

    expect(ordered.map((draft) => draft.id)).toEqual(["agent", "ran", "edited", "browsed-new", "browsed-old"]);
  });

  // Clearing untouched drafts must not reach the agent's row or your work.
  it("counts untouched and edited without the agent's row", () => {
    const list = [draft("browsed", NOW), draft("edited", NOW, { code: listShows + "// mine" }), draft("agent", NOW, { agentClient: "Claude" })];

    expect(untouchedDrafts(list).map((draft) => draft.id)).toEqual(["browsed"]);
    expect(editedDrafts(list).map((draft) => draft.id)).toEqual(["edited"]);
  });

  // Clicking a method takes over a browsing buffer of your own, never the one an
  // agent is writing in.
  it("never reopens the agent's draft as a browsing buffer", () => {
    const agent = draft("agent", NOW, { agentClient: "Claude" });
    expect(findUntouched([agent], agent.code, agent.originAppName)).toBeUndefined();
  });
});

describe("appendCall", () => {
  it("folds a second call from the same module into the existing import", () => {
    const merged = appendCall(listShows, getShow);

    expect(merged.match(/^import/gm)).toHaveLength(1);
    expect(merged).toContain("TheKajaTheatre.ListShows({});");
    expect(merged).toContain('TheKajaTheatre.GetShow({ id: "" });');
  });

  it("adds the missing name when the module is imported but the binding isn't", () => {
    const withEnum = appendCall(listShows, `import { TheKajaTheatre, Genre } from "theatre/service";\n\nTheKajaTheatre.GetShow({});\n`);

    expect(withEnum.match(/^import/gm)).toHaveLength(1);
    expect(withEnum).toContain("{ TheKajaTheatre, Genre }");
  });

  it("adds a whole import line for a module that isn't there yet", () => {
    const merged = appendCall(listShows, getSeatMap);

    expect(merged.match(/^import/gm)).toHaveLength(2);
    expect(merged).toContain('from "seating/service"');
    expect(merged.indexOf("Seating.GetSeatMap")).toBeGreaterThan(merged.indexOf("TheKajaTheatre.ListShows"));
  });

  // The REST door is exported as `api` and read under the app's name, so a name folded
  // into an existing line has to arrive as it was written: `api` alone binds nothing.
  it("folds an aliased binding in as it was written", () => {
    const merged = appendCall(
      `import { TheKajaTheatre } from "theatre/service";\n\nTheKajaTheatre.ListShows({});\n`,
      `import { api as theatre } from "theatre/service";\n\ntheatre.get("/shows");\n`,
    );

    expect(merged.match(/^import/gm)).toHaveLength(1);
    expect(merged).toContain("{ TheKajaTheatre, api as theatre }");
    expect(merged).toContain('theatre.get("/shows");');
  });

  it("does not fold in a binding the line already has under its alias", () => {
    const merged = appendCall(
      `import { api as theatre } from "theatre/service";\n\ntheatre.get("/shows");\n`,
      `import { api as theatre } from "theatre/service";\n\ntheatre.get("/venues");\n`,
    );

    expect(merged.match(/^import/gm)).toHaveLength(1);
    expect(merged).toContain("{ api as theatre }");
    expect(merged).not.toContain("api as theatre, api as theatre");
  });

  it("keeps whatever the author wrote in between", () => {
    const authored = `import { TheKajaTheatre } from "theatre/service";\n\n// my note\nconst shows = TheKajaTheatre.ListShows({});\n`;
    expect(appendCall(authored, getShow)).toContain("// my note");
  });
});
