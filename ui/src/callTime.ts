// The call history reads the wall clock instead of an age: an absolute time is
// written once and never re-renders, and it is the value that lines up with a
// server log.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Always eight characters, so the column it sits in never has to resize.
export function formatClockTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Older calls are grouped under one dimmed date rather than carrying a longer
// string on every row.
export function formatDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function isSameDay(a: number, b: number): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return dateA.getFullYear() === dateB.getFullYear() && dateA.getMonth() === dateB.getMonth() && dateA.getDate() === dateB.getDate();
}

// A call in flight is the one value that has to move; it counts in tenths, so
// the tick driving it never runs finer than what it shows.
export function formatElapsed(milliseconds: number): string {
  return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
