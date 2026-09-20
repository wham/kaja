import { describe, expect, it } from "bun:test";
import { matchParts, methodTag, sheetStops, snapSheet, tapSheet } from "./phone";

describe("sheetStops", () => {
  it("orders the three places from the top down", () => {
    expect(sheetStops(600)).toEqual([
      { position: "full", offset: 0 },
      { position: "half", offset: 270 },
      { position: "rest", offset: 600 },
    ]);
  });
});

describe("snapSheet", () => {
  const stops = sheetStops(600);

  it("moves one place in the flick's own direction", () => {
    expect(snapSheet(0, stops, 1, "full")).toBe("half");
    expect(snapSheet(270, stops, 1, "half")).toBe("rest");
    expect(snapSheet(600, stops, -1, "rest")).toBe("half");
    expect(snapSheet(270, stops, -1, "half")).toBe("full");
  });

  it("stops at the end it is already on", () => {
    expect(snapSheet(600, stops, 1, "rest")).toBe("rest");
    expect(snapSheet(0, stops, -1, "full")).toBe("full");
  });

  it("lands a slow drag on the nearest place", () => {
    expect(snapSheet(60, stops, 0.1, "half")).toBe("full");
    expect(snapSheet(300, stops, -0.1, "rest")).toBe("half");
    expect(snapSheet(560, stops, 0, "half")).toBe("rest");
  });
});

describe("tapSheet", () => {
  it("raises a resting sheet and drops a raised one", () => {
    expect(tapSheet("rest")).toBe("half");
    expect(tapSheet("half")).toBe("rest");
    expect(tapSheet("full")).toBe("rest");
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
