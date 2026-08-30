import { describe, expect, it } from "bun:test";
import { bindMembers } from "./bindMembers";
import { formatLine, logFileLevel, scriptConsole } from "./scriptConsole";
import { LogLevel } from "./server/api";

function recorder() {
  const lines: { level: LogLevel; message: string }[] = [];
  return { lines, sink: (level: LogLevel, message: string) => void lines.push({ level, message }) };
}

// A console that records what it was asked to do, standing in for the real one.
function fakeConsole(): { console: Console; calls: string[] } {
  const calls: string[] = [];
  const base = {
    log: (...parts: unknown[]) => calls.push(`log:${parts.join(" ")}`),
    info: (...parts: unknown[]) => calls.push(`info:${parts.join(" ")}`),
    warn: (...parts: unknown[]) => calls.push(`warn:${parts.join(" ")}`),
    error: (...parts: unknown[]) => calls.push(`error:${parts.join(" ")}`),
    debug: (...parts: unknown[]) => calls.push(`debug:${parts.join(" ")}`),
    table: (rows: unknown) => calls.push(`table:${JSON.stringify(rows)}`),
    group: () => calls.push("group"),
  };
  return { console: base as unknown as Console, calls };
}

describe("scriptConsole", () => {
  it("reports each level method at its proto level", () => {
    const { lines, sink } = recorder();
    const script = scriptConsole(sink, fakeConsole().console);

    script.debug("d");
    script.log("l");
    script.info("i");
    script.warn("w");
    script.error("e");

    expect(lines).toEqual([
      { level: LogLevel.LEVEL_DEBUG, message: "d" },
      // log and info are one level, which is what they effectively are anyway.
      { level: LogLevel.LEVEL_INFO, message: "l" },
      { level: LogLevel.LEVEL_INFO, message: "i" },
      { level: LogLevel.LEVEL_WARN, message: "w" },
      { level: LogLevel.LEVEL_ERROR, message: "e" },
    ]);
  });

  it("still forwards the level methods to the real console", () => {
    const real = fakeConsole();
    const script = scriptConsole(recorder().sink, real.console);

    script.log("hello");
    script.error("boom");

    expect(real.calls).toEqual(["log:hello", "error:boom"]);
  });

  /**
   * The five-method stand-in this replaced made `console.table(rows)` throw
   * "console.table is not a function" inside a script — a particularly bad way to
   * find out that logging is being intercepted.
   */
  it("passes everything that is not a level straight through", () => {
    const real = fakeConsole();
    const { lines, sink } = recorder();
    const script = scriptConsole(sink, real.console);

    script.table([{ id: 1 }]);
    script.group();

    expect(real.calls).toEqual(['table:[{"id":1}]', "group"]);
    // Instrumentation is devtools' business and stays there.
    expect(lines).toEqual([]);
  });

  it("keeps working when the sink throws", () => {
    const real = fakeConsole();
    const script = scriptConsole(() => {
      throw new Error("the console is gone");
    }, real.console);

    expect(() => script.log("still printed")).not.toThrow();
    expect(real.calls).toEqual(["log:still printed"]);
  });

  it("finds methods that live on the prototype", () => {
    const calls: string[] = [];
    const prototype = { log: (...parts: unknown[]) => calls.push(parts.join(" ")) };
    const real = Object.create(prototype) as Console;

    scriptConsole(recorder().sink, real).log("from the prototype");

    expect(calls).toEqual(["from the prototype"]);
  });

  it("clones a console without carrying its later patches", () => {
    const real = fakeConsole();
    const clone = bindMembers(real.console);
    (real.console as { log: unknown }).log = () => real.calls.push("patched");

    clone.log("original");

    expect(real.calls).toEqual(["log:original"]);
  });
});

describe("formatLine", () => {
  it("keeps strings as they were written and JSONs everything else", () => {
    expect(formatLine(["shows:", 3, { id: "a" }])).toBe('shows: 3 {"id":"a"}');
  });

  // A bigint has no JSON form and is an ordinary proto field value.
  it("prints a bigint rather than throwing over it", () => {
    expect(formatLine([{ total: 9007199254740993n }])).toBe('{"total":"9007199254740993"}');
  });

  it("names an error rather than serialising it to {}", () => {
    expect(formatLine([new TypeError("bad shape")])).toBe("TypeError: bad shape");
  });

  it("survives a value that cannot be serialised", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => formatLine([cyclic])).not.toThrow();
  });
});

describe("logFileLevel", () => {
  it("keeps the level column a level", () => {
    expect(logFileLevel(LogLevel.LEVEL_DEBUG)).toBe("DEBUG");
    expect(logFileLevel(LogLevel.LEVEL_INFO)).toBe("INFO");
    expect(logFileLevel(LogLevel.LEVEL_WARN)).toBe("WARN");
    expect(logFileLevel(LogLevel.LEVEL_ERROR)).toBe("ERROR");
  });
});
