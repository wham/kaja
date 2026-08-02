import { describe, expect, it } from "bun:test";
import { formatClockTime, formatDayLabel, formatElapsed, isSameDay } from "./callTime";

const at = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0) => new Date(year, month - 1, day, hours, minutes, seconds).getTime();

describe("formatClockTime", () => {
  it("is always eight characters", () => {
    expect(formatClockTime(at(2026, 7, 31, 14, 32, 8))).toBe("14:32:08");
    expect(formatClockTime(at(2026, 7, 31, 0, 0, 0))).toBe("00:00:00");
    expect(formatClockTime(at(2026, 7, 31, 23, 59, 59))).toBe("23:59:59");
    expect(formatClockTime(at(2026, 7, 31, 9, 5, 3))).toHaveLength(8);
  });
});

describe("formatDayLabel", () => {
  it("names the day without the year", () => {
    expect(formatDayLabel(at(2026, 7, 31, 12))).toBe("Jul 31");
    expect(formatDayLabel(at(2026, 1, 1, 12))).toBe("Jan 1");
  });
});

describe("isSameDay", () => {
  it("compares calendar days, not elapsed time", () => {
    expect(isSameDay(at(2026, 8, 1, 0, 0, 1), at(2026, 8, 1, 23, 59, 59))).toBe(true);
    expect(isSameDay(at(2026, 7, 31, 23, 59, 59), at(2026, 8, 1, 0, 0, 1))).toBe(false);
    expect(isSameDay(at(2025, 8, 1, 12), at(2026, 8, 1, 12))).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("counts in tenths and never goes negative", () => {
    expect(formatElapsed(654)).toBe("0.7s");
    expect(formatElapsed(12340)).toBe("12.3s");
    expect(formatElapsed(-50)).toBe("0.0s");
  });
});
