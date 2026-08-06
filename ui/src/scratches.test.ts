import { describe, expect, it } from "bun:test";
import { appendCall, createScratch, isUntouched, markRun, pruneScratches, renameScratch, Scratch, takeOver, withCode } from "./scratches";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const listShows = `import { TheKajaTheatre } from "theatre/service";\n\nTheKajaTheatre.ListShows({});\n`;
const getShow = `import { TheKajaTheatre } from "theatre/service";\n\nTheKajaTheatre.GetShow({ id: "" });\n`;
const getSeatMap = `import { Seating } from "seating/service";\n\nSeating.GetSeatMap({});\n`;

describe("createScratch", () => {
  it("names itself from the code it was born with", () => {
    expect(createScratch(listShows, undefined, NOW).title).toBe("ListShows");
  });

  it("falls back when the code calls nothing", () => {
    expect(createScratch("// empty", undefined, NOW).title).toBe("Scratch");
  });
});

describe("isUntouched", () => {
  it("is true only while the code is still what was generated and nothing has run", () => {
    const scratch = createScratch(listShows, undefined, NOW);
    expect(isUntouched(scratch)).toBe(true);
    expect(isUntouched({ ...scratch, code: listShows + "// mine" })).toBe(false);
    expect(isUntouched({ ...scratch, ran: true })).toBe(false);
  });
});

describe("takeOver", () => {
  it("re-points a browsing buffer at another method and renames it", () => {
    const taken = takeOver(createScratch(listShows, undefined, NOW), getShow, undefined, NOW + 1);
    expect(taken.title).toBe("GetShow");
    expect(isUntouched(taken)).toBe(true);
  });

  it("leaves a name the user chose alone", () => {
    const named = renameScratch(createScratch(listShows, undefined, NOW), "my thing", NOW);
    expect(takeOver(named, getShow, undefined, NOW + 1).title).toBe("my thing");
  });
});

describe("markRun", () => {
  it("re-reads the title from the code as it stands at the run", () => {
    const scratch = createScratch(getShow, undefined, NOW);
    const filled = getShow.replace('id: ""', 'id: "vera-lune"');
    const ran = markRun(scratch, filled, NOW + 1);

    expect(ran.title).toBe("GetShow · vera-lune");
    expect(ran.ran).toBe(true);
  });

  it("never overrides a pinned title", () => {
    const named = renameScratch(createScratch(getShow, undefined, NOW), "seat check", NOW);
    expect(markRun(named, listShows, NOW + 1).title).toBe("seat check");
  });
});

describe("withCode", () => {
  it("settles the title on an append, the way a run does", () => {
    const appended = withCode(createScratch(listShows, undefined, NOW), appendCall(listShows, getShow), NOW + 1);
    expect(appended.title).toBe("ListShows → GetShow");
  });
});

describe("pruneScratches", () => {
  const stale = (id: string, extra: Partial<Scratch> = {}): Scratch => ({
    ...createScratch(listShows, undefined, NOW - 30 * DAY),
    id,
    updatedAt: NOW - 30 * DAY,
    ...extra,
  });

  it("drops old browsing buffers and keeps everything that was worked in", () => {
    const kept = pruneScratches(
      [stale("browsed"), stale("ran", { ran: true }), stale("edited", { code: listShows + "// mine" }), createScratch(listShows, undefined, NOW)],
      NOW,
      new Set(),
    );

    expect(kept.map((scratch) => scratch.id)).toEqual(["ran", "edited", kept[2].id]);
  });

  it("never drops one that is open", () => {
    expect(pruneScratches([stale("browsed")], NOW, new Set(["browsed"]))).toHaveLength(1);
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

  it("keeps whatever the author wrote in between", () => {
    const authored = `import { TheKajaTheatre } from "theatre/service";\n\n// my note\nconst shows = TheKajaTheatre.ListShows({});\n`;
    expect(appendCall(authored, getShow)).toContain("// my note");
  });
});
