import { describe, expect, it } from "bun:test";
import { readInstant, timeAgo } from "./cellTime";

describe("readInstant", () => {
  it("reads an instant with its zone", () => {
    expect(readInstant("2024-03-01T12:00:00Z")?.toISOString()).toBe("2024-03-01T12:00:00.000Z");
    expect(readInstant("2024-03-01T12:00:00.123+02:00")?.toISOString()).toBe("2024-03-01T10:00:00.123Z");
  });

  it("leaves a day, a wall clock and anything else alone", () => {
    expect(readInstant("2024-03-01")).toBeUndefined();
    expect(readInstant("2024-03-01T12:00:00")).toBeUndefined();
    expect(readInstant("Fri 12:00")).toBeUndefined();
    expect(readInstant("1709294400")).toBeUndefined();
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2024-03-10T12:00:00Z");
  const at = (iso: string) => timeAgo(new Date(iso), now);

  it("says how long ago, in the largest unit that reads", () => {
    expect(at("2024-03-10T11:59:40Z")).toBe("just now");
    expect(at("2024-03-10T11:15:00Z")).toBe("45m ago");
    expect(at("2024-03-09T12:00:00Z")).toBe("24h ago");
    expect(at("2024-03-01T12:00:00Z")).toBe("9d ago");
  });

  it("says how long until, for an instant still to come", () => {
    expect(at("2024-03-10T15:00:00Z")).toBe("in 3h");
  });

  it("gives the date past two months", () => {
    expect(at("2023-01-01T00:00:00Z")).toBe(
      new Date("2023-01-01T00:00:00Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    );
  });
});
