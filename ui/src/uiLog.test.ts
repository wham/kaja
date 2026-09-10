import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { clearAppErrors, getAppErrors, setAppErrorSchedule } from "./appErrors";
import { scriptConsole } from "./scriptConsole";
import { deviceConsole, installUiLog } from "./uiLog";

const frames: (() => void)[] = [];

function paint(): void {
  while (frames.length > 0) frames.shift()!();
}

const handlers = new Map<string, (event: unknown) => void>();

// installUiLog hooks the window's own error events, so the stub keeps them and `raise`
// is what the window would have done. Installed in `beforeAll` rather than at module
// load because several test files assign `globalThis.window` a bare object of their
// own while they load.
beforeAll(() => {
  const host = globalThis as { window?: { addEventListener?: unknown } };
  host.window ??= {};
  host.window.addEventListener = (type: string, listener: (event: unknown) => void) => {
    handlers.set(type, listener);
  };
  installUiLog();
});

function raise(event: { message: string; error?: unknown; filename?: string; lineno?: number; colno?: number }): void {
  handlers.get("error")!(event);
}

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

  it("records an error event nobody caught", () => {
    raise({ message: "Something broke", filename: "wails://localhost/main.js", lineno: 12, colno: 3 });

    expect(getAppErrors()).toHaveLength(1);
    expect(getAppErrors()[0].message).toBe("Something broke (wails://localhost/main.js:12:3)");
  });

  it("does not record the ResizeObserver notice, which is nothing having failed", () => {
    raise({ message: "ResizeObserver loop completed with undelivered notifications.", filename: "wails://localhost/", lineno: 0, colno: 0 });
    raise({ message: "ResizeObserver loop limit exceeded" });

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
