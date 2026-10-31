import { describe, expect, test } from "bun:test";
import { App, CompilationStatus, createPendingApp } from "./apps";
import { LogLevel } from "./server/api";
import { countMethods, countWarnings, firstErrorLine, firstErrorMessage, warningCount } from "./compileSummary";

// The surface keeps what the store read off the log, which is what the store writes
// when a compile lands (appStore.ts).
function app(name: string, status: CompilationStatus, logs: { level: LogLevel; message: string }[] = []): App {
  const app = createPendingApp({ name, grpc: { url: "", protoDir: "", headers: {} }, app: { oneofKind: "grpc" } } as any);
  app.compilation = { status, warnings: countWarnings(logs), error: status === "error" ? firstErrorLine(logs) : undefined };
  return app;
}

const WARN = { level: LogLevel.LEVEL_WARN, message: "deprecated option" };
const ERROR = { level: LogLevel.LEVEL_ERROR, message: "unknown type Foo" };

describe("app details", () => {
  test("warnings are only read off a successful compile", () => {
    expect(warningCount(app("a", "success", [WARN]))).toBe(1);
    expect(warningCount(app("a", "error", [WARN]))).toBe(0);
  });

  test("a surface read back from the last session reads as ready", () => {
    expect(warningCount(app("a", "cached", [WARN]))).toBe(1);
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
      { name: "S", packageName: "p", sourcePath: "", typeName: "", methods: [{ name: "m" }, { name: "n" }] },
      { name: "T", packageName: "p", sourcePath: "", typeName: "", methods: [{ name: "o" }] },
    ];
    expect(countMethods(withServices)).toBe(3);
  });
});
