import { describe, expect, test } from "bun:test";
import { App, CompilationStatus, createPendingApp } from "./apps";
import { LogLevel } from "./server/api";
import { appWarnings, countMethods, firstErrorMessage, settledLabel, summarizeCompilation } from "./compileSummary";

function app(name: string, status: CompilationStatus, logs: { level: LogLevel; message: string }[] = []): App {
  const app = createPendingApp({ name, grpc: { url: "", protoDir: "", headers: {} }, app: { oneofKind: "grpc" } } as any);
  app.compilation = { status, logs: logs.map((log) => ({ level: log.level, message: log.message })) as any };
  return app;
}

const WARN = { level: LogLevel.LEVEL_WARN, message: "deprecated option" };
const ERROR = { level: LogLevel.LEVEL_ERROR, message: "unknown type Foo" };

describe("summarizeCompilation", () => {
  test("no apps yet and no configuration is still loading", () => {
    expect(summarizeCompilation([], false)).toMatchObject({ state: "loading", label: "Loading…" });
  });

  test("a workspace with no apps says nothing", () => {
    expect(summarizeCompilation([], true)).toMatchObject({ state: "empty", label: "" });
  });

  test("all ready counts the apps", () => {
    expect(summarizeCompilation([app("a", "success"), app("b", "success")], true)).toMatchObject({ state: "ready", label: "2 apps", ready: 2 });
  });

  test("a single app is not pluralized", () => {
    expect(summarizeCompilation([app("a", "success")], true)).toMatchObject({ state: "ready", label: "1 app" });
  });

  test("one app compiling is named", () => {
    expect(summarizeCompilation([app("seating", "running"), app("b", "success")], true)).toMatchObject({
      state: "compiling",
      label: "Compiling seating…",
    });
  });

  test("several apps compiling are counted", () => {
    expect(summarizeCompilation([app("a", "running"), app("b", "pending")], true)).toMatchObject({ state: "compiling", label: "Compiling 2 apps…" });
  });

  test("some failed reports the share of the workspace", () => {
    const apps = [app("a", "error", [ERROR]), app("b", "success"), app("c", "success")];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "failed", label: "1 of 3 apps failed", failed: 1 });
  });

  test("all failed says so", () => {
    const apps = [app("a", "error", [ERROR]), app("b", "error", [ERROR])];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "failed", label: "All 2 apps failed" });
  });

  test("the only app is named when it fails", () => {
    expect(summarizeCompilation([app("quirks", "error", [ERROR])], true)).toMatchObject({ state: "failed", label: "quirks failed" });
  });

  test("failure outranks a compile still in flight", () => {
    const apps = [app("a", "error", [ERROR]), app("b", "running")];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "failed", label: "1 of 2 apps failed" });
  });

  test("warnings surface once everything settles", () => {
    const apps = [app("a", "success", [WARN]), app("b", "success")];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "warning", label: "2 apps · 1 warning" });
  });

  test("progress outranks a warning", () => {
    const apps = [app("a", "success", [WARN]), app("b", "running")];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "compiling" });
  });

  test("warnings on an app that failed are not counted twice", () => {
    const apps = [app("a", "error", [WARN, ERROR]), app("b", "success")];
    expect(summarizeCompilation(apps, true)).toMatchObject({ state: "failed", warnings: 0 });
  });
});

describe("app details", () => {
  test("warnings are only read off a successful compile", () => {
    expect(appWarnings(app("a", "success", [WARN]))).toHaveLength(1);
    expect(appWarnings(app("a", "error", [WARN]))).toHaveLength(0);
  });

  test("the first error is the line worth showing", () => {
    expect(firstErrorMessage(app("a", "error", [{ level: LogLevel.LEVEL_INFO, message: "Starting" }, ERROR]))).toBe("unknown type Foo");
  });

  test("without an error line the last log stands in", () => {
    expect(firstErrorMessage(app("a", "error", [{ level: LogLevel.LEVEL_INFO, message: "Starting" }]))).toBe("Starting");
  });

  test("an app that logged nothing has no line", () => {
    expect(firstErrorMessage(app("a", "error"))).toBeUndefined();
  });

  test("methods are counted across services", () => {
    const withServices = app("a", "success");
    withServices.services = [
      { name: "S", packageName: "p", sourcePath: "", clientStubModuleId: "", methods: [{ name: "m" }, { name: "n" }] },
      { name: "T", packageName: "p", sourcePath: "", clientStubModuleId: "", methods: [{ name: "o" }] },
    ];
    expect(countMethods(withServices)).toBe(3);
  });
});

describe("settledLabel", () => {
  test("sub-second compiles keep a decimal", () => {
    expect(settledLabel([app("a", "success")], 1400)).toBe("1 app ready · 1.4s");
  });

  test("a very fast compile still reads as time passing", () => {
    expect(settledLabel([app("a", "success")], 12)).toBe("1 app ready · 0.1s");
  });

  test("long compiles round to whole seconds", () => {
    expect(settledLabel([app("a", "success"), app("b", "success")], 12400)).toBe("2 apps ready · 12s");
  });
});
