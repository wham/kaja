import { describe, expect, it } from "bun:test";
import { deriveScratchTitle, proposeFileName, proposeFileNames, readCalls, titleParts } from "./scratchTitle";

const generated = (body: string, names = "TheKajaTheatre") => `import { ${names} } from "theatre/service";\n\n${body}\n`;

describe("readCalls", () => {
  it("reads calls on imported receivers, in source order", () => {
    const code = generated(`TheKajaTheatre.ListShows({});\nTheKajaTheatre.GetShow({ id: "" });`);
    expect(readCalls(code).map((call) => call.method)).toEqual(["ListShows", "GetShow"]);
  });

  it("ignores anything the file didn't import", () => {
    const code = generated(`console.log("hi");\nJSON.parse("{}");\nTheKajaTheatre.ListShows({});`);
    expect(readCalls(code).map((call) => call.method)).toEqual(["ListShows"]);
  });

  it("falls back to a capitalized receiver when there are no imports", () => {
    expect(readCalls(`console.log(1);\nSeating.GetSeatMap({});`).map((call) => call.method)).toEqual(["GetSeatMap"]);
  });
});

describe("deriveScratchTitle", () => {
  it("is the method when the call is about nothing in particular", () => {
    expect(deriveScratchTitle(generated(`TheKajaTheatre.ListShows({});`))).toBe("ListShows");
  });

  // The generated request only holds zero values, so a title only gains a
  // subject once the user has actually filled something in.
  it("ignores the zero values a generated request starts with", () => {
    expect(deriveScratchTitle(generated(`TheKajaTheatre.GetShow({ id: "", limit: 0 });`))).toBe("GetShow");
  });

  it("adds the identifying value once one is typed", () => {
    expect(deriveScratchTitle(generated(`TheKajaTheatre.GetShow({ id: "vera-lune" });`))).toBe("GetShow · vera-lune");
  });

  it("prefers an id over a name, and finds one nested", () => {
    expect(deriveScratchTitle(generated(`TheKajaTheatre.GetShow({ name: "Neon", show: { id: 42 } });`))).toBe("GetShow · 42");
  });

  it("truncates a long subject", () => {
    const code = generated(`TheKajaTheatre.GetShow({ id: "an-extremely-long-identifier-value" });`);
    expect(deriveScratchTitle(code)).toBe("GetShow · an-extremely-long-ident…");
  });

  // Two explorations of the same call usually differ in their arguments, which
  // is what tells the two rows apart.
  it("describes a small request by the values that were filled in", () => {
    expect(deriveScratchTitle(generated(`Add.Sum({ a: 5, b: 3 });`, "Add"))).toBe("Sum · 5, 3");
    expect(deriveScratchTitle(generated(`Add.Sum({ a: 5, b: 0 });`, "Add"))).toBe("Sum · 5");
    expect(deriveScratchTitle(generated(`Add.Sum({ a: 0, b: 0 });`, "Add"))).toBe("Sum");
  });

  it("stays quiet about a request too big to read at a glance", () => {
    const code = generated(`TheKajaTheatre.ListShows({ genre: "jazz", limit: 10, offset: 0, page: 1 });`);
    expect(deriveScratchTitle(code)).toBe("ListShows");
  });

  it("stays quiet when a small request holds something that isn't a scalar", () => {
    expect(deriveScratchTitle(generated(`Add.Sum({ a: 5, rest: [1, 2] });`, "Add"))).toBe("Sum");
  });

  it("reads two methods as a sequence", () => {
    const code = generated(`TheKajaTheatre.ListShows({});\nTheKajaTheatre.GetShow({});`);
    expect(deriveScratchTitle(code)).toBe("ListShows → GetShow");
  });

  it("counts the rest past two", () => {
    const code = generated(`TheKajaTheatre.CreateShow({});\nTheKajaTheatre.ListShows({});\nTheKajaTheatre.GetShow({});`);
    expect(deriveScratchTitle(code)).toBe("CreateShow +2");
  });

  it("treats the same method called repeatedly as one method", () => {
    const code = generated(`TheKajaTheatre.GetShow({ id: "a" });\nTheKajaTheatre.GetShow({ id: "b" });`);
    expect(deriveScratchTitle(code)).toBe("GetShow · a");
  });

  it('ignores a 64-bit zero, which is generated as the string "0"', () => {
    const code = generated(`Add.Sum({ a: "0", b: "0" });`, "Add");
    expect(deriveScratchTitle(code)).toBe("Sum");
  });

  it("still reads a filled 64-bit value", () => {
    const code = generated(`Add.Sum({ a: "5", b: "3" });`, "Add");
    expect(deriveScratchTitle(code)).toBe("Sum · 5, 3");
  });

  it("has nothing to say about code that calls nothing", () => {
    expect(deriveScratchTitle(`const x = 1;`)).toBeUndefined();
  });
});

describe("titleParts", () => {
  it("splits the qualifier off, so a row can dim it", () => {
    expect(titleParts("GetShow · vera-lune")).toEqual({ name: "GetShow", qualifier: "· vera-lune" });
    expect(titleParts("Sum · 5, 3")).toEqual({ name: "Sum", qualifier: "· 5, 3" });
  });

  it("leaves a bare name alone", () => {
    expect(titleParts("ListShows")).toEqual({ name: "ListShows" });
    expect(titleParts("ListShows → GetShow")).toEqual({ name: "ListShows → GetShow" });
  });
});

describe("proposeFileName", () => {
  it("takes the name and drops the qualifier, so the section keeps one convention", () => {
    expect(proposeFileName("GetShow · vera-lune")).toBe("getShow");
    expect(proposeFileName("Sum · 5, 3")).toBe("sum");
    expect(proposeFileName("ListShows → GetShow")).toBe("listShows");
  });

  it("has something to call a scratch that names nothing", () => {
    expect(proposeFileName("")).toBe("scratch");
    expect(proposeFileName("· · ·")).toBe("scratch");
  });

  it("steps past what is already on disk, extension or not", () => {
    expect(proposeFileName("GetShow", ["getShow.ts"])).toBe("getShow2");
    expect(proposeFileName("GetShow", ["getShow.ts", "getShow2.ts"])).toBe("getShow3");
    expect(proposeFileName("GetShow", ["GETSHOW.ts"])).toBe("getShow2");
  });
});

describe("proposeFileNames", () => {
  it("names a whole pile without collisions, so the confirm lists what gets written", () => {
    expect(proposeFileNames(["GetShow · a", "GetShow · b", "ListShows"])).toEqual(["getShow", "getShow2", "listShows"]);
  });

  it("counts what is already on disk too", () => {
    expect(proposeFileNames(["GetShow", "GetShow"], ["getShow.ts"])).toEqual(["getShow2", "getShow3"]);
  });
});

describe("scripts that draw", () => {
  // kaja is imported like a service and called like one, but `kaja.table(...)`
  // is the script drawing rather than a call it made.
  it("is not named after the canvas verbs", () => {
    const code = `import { kaja } from "kaja";\nkaja.text("hello");\nkaja.table(["id"]);\nkaja.code("SELECT 1", "sql");`;
    expect(deriveScratchTitle(code)).toBeUndefined();
  });

  it("still names the call a drawing script makes", () => {
    const code = `import { kaja } from "kaja";\nimport { Shows } from "theatre/shows";\nkaja.text("listing");\nawait Shows.ListShows({});`;
    expect(deriveScratchTitle(code)).toBe("ListShows");
  });

  it("follows the runtime through an alias", () => {
    const code = `import { kaja as k } from "kaja";\nk.text("hello");`;
    expect(deriveScratchTitle(code)).toBeUndefined();
  });
});
