import { describe, expect, it } from "bun:test";
import { matchParts, methodTag, snapDrawer } from "./phone";

describe("snapDrawer", () => {
  it("follows a flick whichever way it went, however short", () => {
    expect(snapDrawer(0.1, 1)).toBe(true);
    expect(snapDrawer(0.9, -1)).toBe(false);
  });

  it("lands a slow drag on the nearer end", () => {
    expect(snapDrawer(0.7, 0.1)).toBe(true);
    expect(snapDrawer(0.3, -0.1)).toBe(false);
    expect(snapDrawer(0.5, 0)).toBe(true);
  });
});

describe("methodTag", () => {
  it("reads write off the HTTP verb and says nothing without one", () => {
    expect(methodTag({ name: "Create", http: "POST /repos/{owner}/{repo}/issues" })).toBe("write");
    expect(methodTag({ name: "Delete", http: "delete /repos/{owner}/{repo}" })).toBe("write");
    expect(methodTag({ name: "ListForUser", http: "GET /users/{username}/repos" })).toBeUndefined();
    expect(methodTag({ name: "Create" })).toBeUndefined();
  });

  it("names a stream over a verb", () => {
    expect(methodTag({ name: "WatchEvents", serverStreaming: true, http: "GET /events" })).toBe("stream");
    expect(methodTag({ name: "Upload", clientStreaming: true })).toBe("stream");
  });
});

describe("matchParts", () => {
  it("splits the name around the first occurrence, whatever the case", () => {
    expect(matchParts("GetByUsername", "user")).toEqual([
      { text: "GetBy", match: false },
      { text: "User", match: true },
      { text: "name", match: false },
    ]);
    expect(matchParts("users", "user")).toEqual([
      { text: "user", match: true },
      { text: "s", match: false },
    ]);
  });

  it("is one part where nothing matched or nothing was asked", () => {
    expect(matchParts("issues.ts", "user")).toEqual([{ text: "issues.ts", match: false }]);
    expect(matchParts("issues.ts", "  ")).toEqual([{ text: "issues.ts", match: false }]);
  });
});
