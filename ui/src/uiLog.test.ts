import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { clearAppErrors, getAppErrors, setAppErrorSchedule } from "./appErrors";
import { scriptConsole } from "./scriptConsole";
import { deviceConsole, installUiLog } from "./uiLog";

const frames: (() => void)[] = [];

function paint(): void {
  while (frames.length > 0) frames.shift()!();
}

// installUiLog hooks the window's own error events; the store is what is under test,
// so a stub that accepts the listeners is all this needs. Installed in `beforeAll`
// rather than at module load because several test files assign `globalThis.window` a
// bare object of their own while they load.
beforeAll(() => {
  const host = globalThis as { window?: { addEventListener?: unknown } };
  host.window ??= {};
  if (typeof host.window.addEventListener !== "function") host.window.addEventListener = () => {};
  installUiLog();
});

beforeEach(() => {
  setAppErrorSchedule((run) => frames.push(run));
  paint();
  clearAppErrors();
  paint();
});

describe("installUiLog", () => {
  it("records what console.error reports", () => {
    console.error("Failed to write to storage:", new Error("QuotaExceeded"));

    expect(getAppErrors()).toHaveLength(1);
    expect(getAppErrors()[0].message).toContain("QuotaExceeded");
  });

  it("does not record a warning, which is something Kaja carried on past", () => {
    console.warn("Failed to format typescript");

    expect(getAppErrors()).toEqual([]);
  });
});

describe("the line between Kaja's errors and a script's", () => {
  // The whole of the separation: `deviceConsole` is read at uiLog's own module load,
  // so it is the console as it was before the patch. If this ever stops holding, every
  // `console.error` a script prints lands in the footer.
  it("holds the console as it was before the patch", () => {
    expect(deviceConsole.error).not.toBe(console.error);
  });

  it("keeps a script's console.error out of the store", () => {
    const printed: string[] = [];
    const script = scriptConsole((_level, message) => printed.push(message), deviceConsole);

    script.error("no such show");

    expect(printed).toEqual(["no such show"]);
    expect(getAppErrors()).toEqual([]);
  });
});
