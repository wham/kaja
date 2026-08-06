import { describe, expect, it } from "bun:test";
import { deriveScratchTitle, readCalls } from "./scratchTitle";

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

  it("has nothing to say about code that calls nothing", () => {
    expect(deriveScratchTitle(`const x = 1;`)).toBeUndefined();
  });
});
