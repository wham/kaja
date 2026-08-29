import { describe, it, expect } from "bun:test";
import { restCallAt } from "./restCallAt";

const script = `import { api as theatre } from "theatre";
import { api as store } from "petstore";

const shows = await theatre.get("/shows", { city: "Chicago" });
await store.post("/pets", { name: "/shows" });
`;

// The offset of the nth occurrence of a piece of text, inside it rather than at its edge.
function inside(code: string, text: string, occurrence = 1): number {
  let at = -1;
  for (let i = 0; i < occurrence; i++) at = code.indexOf(text, at + 1);
  return at + 2;
}

describe("restCallAt", () => {
  it("reads the call whose path is under the cursor", () => {
    const call = restCallAt(script, inside(script, '"/shows"'));
    expect(call).toEqual({ appSpecifier: "theatre", verb: "GET", path: "/shows", start: expect.any(Number), end: expect.any(Number) });
  });

  it("keeps each door with the app it was imported from", () => {
    expect(restCallAt(script, inside(script, '"/pets"'))?.appSpecifier).toBe("petstore");
    expect(restCallAt(script, inside(script, '"/pets"'))?.verb).toBe("POST");
  });

  // The path is what is hovered, so a string that happens to look like one is not it.
  it("says nothing about a string that is not the path argument", () => {
    expect(restCallAt(script, inside(script, '"/shows"', 2))).toBeUndefined();
    expect(restCallAt(script, inside(script, '"Chicago"'))).toBeUndefined();
  });

  it("says nothing where the cursor is not in a string at all", () => {
    expect(restCallAt(script, script.indexOf("const shows"))).toBeUndefined();
  });

  // The door is an ordinary local binding, so a receiver that was never imported as
  // one is not a door however it is spelled.
  it("says nothing for a receiver that is not a door", () => {
    const other = `const theatre = { get: (p: string) => p };\ntheatre.get("/shows");\n`;
    expect(restCallAt(other, inside(other, '"/shows"'))).toBeUndefined();
  });

  it("follows the door under whatever name it was bound to", () => {
    const renamed = `import { api } from "theatre";\napi.delete("/shows/{showId}", { showId: "x" });\n`;
    const call = restCallAt(renamed, inside(renamed, '"/shows/{showId}"'));
    expect(call?.verb).toBe("DELETE");
    expect(call?.path).toBe("/shows/{showId}");
    expect(call?.appSpecifier).toBe("theatre");
  });

  it("underlines the literal, quotes included", () => {
    const call = restCallAt(script, inside(script, '"/shows"'))!;
    expect(script.slice(call.start, call.end)).toBe('"/shows"');
  });

  it("says nothing in a file that imports no door", () => {
    const none = `import { Shows } from "theatre";\nShows.GetShow({ showId: "/shows" });\n`;
    expect(restCallAt(none, inside(none, '"/shows"'))).toBeUndefined();
  });
});
