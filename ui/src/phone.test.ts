import { describe, expect, it } from "bun:test";
import { matchParts, methodTag, snapSheet } from "./phone";

describe("snapSheet", () => {
  it("follows a flick whichever end the sheet is nearer", () => {
    expect(snapSheet(50, 600, 1)).toBe("rest");
    expect(snapSheet(550, 600, -1)).toBe("up");
  });

  it("lands a slow drag on the nearer end", () => {
    expect(snapSheet(100, 600, 0.1)).toBe("up");
    expect(snapSheet(500, 600, -0.1)).toBe("rest");
    expect(snapSheet(300, 600, 0)).toBe("rest");
  });
});

describe("methodTag", () => {
  it("reads write off the HTTP verb and says nothing without one", () => {
    expect(methodTag({ name: "CreateShow", http: "POST /shows" })).toBe("write");
    expect(methodTag({ name: "DeleteShow", http: "delete /shows/{id}" })).toBe("write");
    expect(methodTag({ name: "ListShows", http: "GET /shows" })).toBeUndefined();
    expect(methodTag({ name: "CreateShow" })).toBeUndefined();
  });

  it("names a stream over a verb", () => {
    expect(methodTag({ name: "WatchShows", serverStreaming: true, http: "GET /shows/watch" })).toBe("stream");
    expect(methodTag({ name: "Upload", clientStreaming: true })).toBe("stream");
  });
});

describe("matchParts", () => {
  it("splits the name around the first occurrence, whatever the case", () => {
    expect(matchParts("GetSeatMap", "seat")).toEqual([
      { text: "Get", match: false },
      { text: "Seat", match: true },
      { text: "Map", match: false },
    ]);
    expect(matchParts("seating", "seat")).toEqual([
      { text: "seat", match: true },
      { text: "ing", match: false },
    ]);
  });

  it("is one part where nothing matched or nothing was asked", () => {
    expect(matchParts("movies.ts", "seat")).toEqual([{ text: "movies.ts", match: false }]);
    expect(matchParts("movies.ts", "  ")).toEqual([{ text: "movies.ts", match: false }]);
  });
});
