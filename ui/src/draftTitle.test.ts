import { describe, expect, it } from "bun:test";
import { deriveDraftTitle, proposeFileName, proposeFileNames, readCalls, titleParts } from "./draftTitle";

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

describe("deriveDraftTitle", () => {
  it("is the method when the call is about nothing in particular", () => {
    expect(deriveDraftTitle(generated(`TheKajaTheatre.ListShows({});`))).toBe("ListShows");
  });

  // The generated request only holds zero values, so a title only gains a
  // subject once the user has actually filled something in.
  it("ignores the zero values a generated request starts with", () => {
    expect(deriveDraftTitle(generated(`TheKajaTheatre.GetShow({ id: "", limit: 0 });`))).toBe("GetShow");
  });

  it("adds the identifying value once one is typed", () => {
    expect(deriveDraftTitle(generated(`TheKajaTheatre.GetShow({ id: "vera-lune" });`))).toBe("GetShow · vera-lune");
  });

  it("prefers an id over a name, and finds one nested", () => {
    expect(deriveDraftTitle(generated(`TheKajaTheatre.GetShow({ name: "Neon", show: { id: 42 } });`))).toBe("GetShow · 42");
  });

  it("truncates a long subject", () => {
    const code = generated(`TheKajaTheatre.GetShow({ id: "an-extremely-long-identifier-value" });`);
    expect(deriveDraftTitle(code)).toBe("GetShow · an-extremely-long-ident…");
  });

  // Two explorations of the same call usually differ in their arguments, which
  // is what tells the two rows apart.
  it("describes a small request by the values that were filled in", () => {
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, b: 3 });`, "Add"))).toBe("Sum · 5, 3");
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, b: 0 });`, "Add"))).toBe("Sum · 5");
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 0, b: 0 });`, "Add"))).toBe("Sum");
  });

  it("stays quiet about a request too big to read at a glance", () => {
    const code = generated(`TheKajaTheatre.ListShows({ genre: "jazz", limit: 10, offset: 0, page: 1 });`);
    expect(deriveDraftTitle(code)).toBe("ListShows");
  });

  it("stays quiet when a small request holds something that isn't a scalar", () => {
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, rest: [1, 2] });`, "Add"))).toBe("Sum");
  });

  it("reads two methods as a sequence", () => {
    const code = generated(`TheKajaTheatre.ListShows({});\nTheKajaTheatre.GetShow({});`);
    expect(deriveDraftTitle(code)).toBe("ListShows → GetShow");
  });

  it("counts the rest past two", () => {
    const code = generated(`TheKajaTheatre.CreateShow({});\nTheKajaTheatre.ListShows({});\nTheKajaTheatre.GetShow({});`);
    expect(deriveDraftTitle(code)).toBe("CreateShow +2");
  });

  it("treats the same method called repeatedly as one method", () => {
    const code = generated(`TheKajaTheatre.GetShow({ id: "a" });\nTheKajaTheatre.GetShow({ id: "b" });`);
    expect(deriveDraftTitle(code)).toBe("GetShow · a");
  });

  it('ignores a 64-bit zero, which is generated as the string "0"', () => {
    const code = generated(`Add.Sum({ a: "0", b: "0" });`, "Add");
    expect(deriveDraftTitle(code)).toBe("Sum");
  });

  it("still reads a filled 64-bit value", () => {
    const code = generated(`Add.Sum({ a: "5", b: "3" });`, "Add");
    expect(deriveDraftTitle(code)).toBe("Sum · 5, 3");
  });

  it("has nothing to say about code that calls nothing", () => {
    expect(deriveDraftTitle(`const x = 1;`)).toBeUndefined();
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

describe("a draft that fetches", () => {
  it("is named the way its row in the log is", () => {
    expect(deriveDraftTitle(`const response = await fetch("https://api.example.com/orders/42");`)).toBe("GET api.example.com · /orders/42");
  });

  it("reads the verb it was written with", () => {
    expect(deriveDraftTitle(`await fetch("https://api.example.com/orders", { method: "post", body });`)).toBe("POST api.example.com · /orders");
  });

  it("reads the host out of a template it can only see the start of", () => {
    expect(deriveDraftTitle("await fetch(`https://api.example.com/orders/${id}`);")).toBe("GET api.example.com · /orders/");
  });

  it("names nothing from an address it cannot read", () => {
    expect(deriveDraftTitle("await fetch(url);")).toBeUndefined();
    expect(deriveDraftTitle("await fetch(`${base}/orders`);")).toBeUndefined();
  });

  it("sits beside the calls a script makes to its apps", () => {
    const code = `import { Shows } from "theatre";\nawait Shows.ListShows({});\nawait fetch("https://hooks.example.com/notify", { method: "POST" });`;
    expect(deriveDraftTitle(code)).toBe("ListShows → POST hooks.example.com");
  });
});

describe("proposeFileName", () => {
  it("takes the name and drops the qualifier, so the section keeps one convention", () => {
    expect(proposeFileName("GetShow · vera-lune")).toBe("getShow");
    expect(proposeFileName("Sum · 5, 3")).toBe("sum");
    expect(proposeFileName("ListShows → GetShow")).toBe("listShows");
  });

  it("has something to call a draft that names nothing", () => {
    expect(proposeFileName("")).toBe("draft");
    expect(proposeFileName("· · ·")).toBe("draft");
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
    expect(deriveDraftTitle(code)).toBeUndefined();
  });

  it("still names the call a drawing script makes", () => {
    const code = `import { kaja } from "kaja";\nimport { Shows } from "theatre/shows";\nkaja.text("listing");\nawait Shows.ListShows({});`;
    expect(deriveDraftTitle(code)).toBe("ListShows");
  });

  it("follows the runtime through an alias", () => {
    const code = `import { kaja as k } from "kaja";\nk.text("hello");`;
    expect(deriveDraftTitle(code)).toBeUndefined();
  });
});
