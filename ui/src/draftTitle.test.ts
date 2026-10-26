import { describe, expect, it } from "bun:test";
import { deriveDraftTitle, draftTitleText, proposeFileName, readCalls, titleParts } from "./draftTitle";

const generated = (body: string, names = "Repos") => `import { ${names} } from "github/service";\n\n${body}\n`;

describe("readCalls", () => {
  it("reads calls on imported receivers, in source order", () => {
    const code = generated(`Repos.ListForUser({});\nRepos.Get({ id: "" });`);
    expect(readCalls(code).map((call) => call.method)).toEqual(["ListForUser", "Get"]);
  });

  it("ignores anything the file didn't import", () => {
    const code = generated(`console.log("hi");\nJSON.parse("{}");\nRepos.ListForUser({});`);
    expect(readCalls(code).map((call) => call.method)).toEqual(["ListForUser"]);
  });

  it("falls back to a capitalized receiver when there are no imports", () => {
    expect(readCalls(`console.log(1);\nHelloService.SayHello({});`).map((call) => call.method)).toEqual(["SayHello"]);
  });
});

describe("deriveDraftTitle", () => {
  it("is the method when the call is about nothing in particular", () => {
    expect(deriveDraftTitle(generated(`Repos.ListForUser({});`))).toBe("ListForUser");
  });

  // The generated request only holds zero values, so a title only gains a
  // subject once the user has actually filled something in.
  it("ignores the zero values a generated request starts with", () => {
    expect(deriveDraftTitle(generated(`Repos.Get({ id: "", limit: 0 });`))).toBe("Get");
  });

  it("adds the identifying value once one is typed", () => {
    expect(deriveDraftTitle(generated(`Repos.Get({ id: "kaja" });`))).toBe("Get · kaja");
  });

  it("prefers an id over a name, and finds one nested", () => {
    expect(deriveDraftTitle(generated(`Repos.Get({ name: "linux", repo: { id: 42 } });`))).toBe("Get · 42");
  });

  it("truncates a long subject", () => {
    const code = generated(`Repos.Get({ id: "an-extremely-long-identifier-value" });`);
    expect(deriveDraftTitle(code)).toBe("Get · an-extremely-long-ident…");
  });

  // Two explorations of the same call usually differ in their arguments, which
  // is what tells the two rows apart.
  it("describes a small request by the values that were filled in", () => {
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, b: 3 });`, "Add"))).toBe("Sum · 5, 3");
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, b: 0 });`, "Add"))).toBe("Sum · 5");
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 0, b: 0 });`, "Add"))).toBe("Sum");
  });

  it("stays quiet about a request too big to read at a glance", () => {
    const code = generated(`Repos.ListForUser({ sort: "updated", perPage: 10, direction: "asc", page: 1 });`);
    expect(deriveDraftTitle(code)).toBe("ListForUser");
  });

  it("stays quiet when a small request holds something that isn't a scalar", () => {
    expect(deriveDraftTitle(generated(`Add.Sum({ a: 5, rest: [1, 2] });`, "Add"))).toBe("Sum");
  });

  it("reads two methods as a sequence", () => {
    const code = generated(`Repos.ListForUser({});\nRepos.Get({});`);
    expect(deriveDraftTitle(code)).toBe("ListForUser → Get");
  });

  it("counts the rest past two", () => {
    const code = generated(`Repos.CreateRelease({});\nRepos.ListForUser({});\nRepos.Get({});`);
    expect(deriveDraftTitle(code)).toBe("CreateRelease +2");
  });

  it("treats the same method called repeatedly as one method", () => {
    const code = generated(`Repos.Get({ id: "a" });\nRepos.Get({ id: "b" });`);
    expect(deriveDraftTitle(code)).toBe("Get · a");
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
  it("splits the qualifier off, so a row can dim it — and spends the separator, which the dimming already says", () => {
    expect(titleParts("Get · kaja")).toEqual({ name: "Get", qualifier: "kaja" });
    expect(titleParts("Sum · 5, 3")).toEqual({ name: "Sum", qualifier: "5, 3" });
  });

  it("leaves a bare name alone", () => {
    expect(titleParts("ListForUser")).toEqual({ name: "ListForUser" });
    expect(titleParts("ListForUser → Get")).toEqual({ name: "ListForUser → Get" });
  });
});

describe("draftTitleText", () => {
  it("says the whole title where nothing dims the qualifier", () => {
    expect(draftTitleText("Get · kaja")).toBe("Get kaja");
    expect(draftTitleText("ListForUser")).toBe("ListForUser");
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
    const code = `import { Repos } from "github";\nawait Repos.ListForUser({});\nawait fetch("https://hooks.example.com/notify", { method: "POST" });`;
    expect(deriveDraftTitle(code)).toBe("ListForUser → POST hooks.example.com");
  });
});

describe("proposeFileName", () => {
  it("takes the name and drops the qualifier, so the section keeps one convention", () => {
    expect(proposeFileName("Get · kaja")).toBe("get");
    expect(proposeFileName("Sum · 5, 3")).toBe("sum");
    expect(proposeFileName("ListForUser → Get")).toBe("listForUser");
  });

  it("has something to call a draft that names nothing", () => {
    expect(proposeFileName("")).toBe("draft");
    expect(proposeFileName("· · ·")).toBe("draft");
  });

  it("steps past what is already on disk, extension or not", () => {
    expect(proposeFileName("Get", ["get.ts"])).toBe("get2");
    expect(proposeFileName("Get", ["get.ts", "get2.ts"])).toBe("get3");
    expect(proposeFileName("Get", ["GET.ts"])).toBe("get2");
  });
});

describe("scripts that draw", () => {
  // kaja is imported like a service and called like one, but `kaja.table(...)`
  // is the script drawing rather than a call it made.
  it("is not named after the canvas verbs", () => {
    const code = `import { kaja } from "kaja";\nkaja.text("hello");\nkaja.table({ title: "Repositories" });\nkaja.code("SELECT 1", "sql");`;
    expect(deriveDraftTitle(code)).toBeUndefined();
  });

  it("still names the call a drawing script makes", () => {
    const code = `import { kaja } from "kaja";\nimport { Repos } from "github/service";\nkaja.text("listing");\nawait Repos.ListForUser({});`;
    expect(deriveDraftTitle(code)).toBe("ListForUser");
  });

  it("follows the runtime through an alias", () => {
    const code = `import { kaja as k } from "kaja";\nk.text("hello");`;
    expect(deriveDraftTitle(code)).toBeUndefined();
  });
});
