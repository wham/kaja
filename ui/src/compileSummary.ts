import { appParameters } from "./appTypes";
import { App, isReady } from "./apps";
import { Log, LogLevel } from "./server/api";
import { pluralCount } from "./plural";

// The compile state of the whole workspace, rolled up for the status bar. A
// failure outranks a warning outranks progress, so the indicator never has to
// combine two states in one label.
export type CompileState = "empty" | "loading" | "compiling" | "failed" | "warning" | "ready";

export interface CompileSummary {
  state: CompileState;
  total: number;
  ready: number;
  failed: number;
  compiling: number;
  // Apps that compiled but logged a warning.
  warnings: number;
  label: string;
}

export function isCompiling(app: App): boolean {
  return app.compilation.status === "pending" || app.compilation.status === "running";
}

// Warnings are read off a compile that succeeded; a failed one has its error to show.
export function warningCount(app: App): number {
  return isReady(app.compilation.status) ? app.compilation.warnings : 0;
}

export function countWarnings(logs: Log[]): number {
  return logs.filter((log) => log.level === LogLevel.LEVEL_WARN).length;
}

// The line to show for a failed app: its first error, falling back to the last
// thing it logged before giving up.
export function firstErrorLine(logs: Log[]): string | undefined {
  const error = logs.find((log) => log.level === LogLevel.LEVEL_ERROR);
  return (error ?? logs[logs.length - 1])?.message;
}

export function firstErrorMessage(app: App): string | undefined {
  return app.compilation.error;
}

// Where the app's calls go, when the app names somewhere for them to go. Read off the
// configuration, because there is no address to read anywhere else: an app is invoked
// under the name every call already carries. "url" is what the app types that name a
// server call it; the ones that don't name one report nothing here.
export function appAddress(app: App): string {
  return appParameters(app.configuration).url ?? "";
}

export function countMethods(app: App): number {
  return app.services.reduce((total, service) => total + service.methods.length, 0);
}

export function summarizeCompilation(apps: App[], workspaceLoaded: boolean): CompileSummary {
  const compiling = apps.filter(isCompiling);
  const failed = apps.filter((app) => app.compilation.status === "error");
  const warned = apps.filter((app) => warningCount(app) > 0);
  const ready = apps.filter((app) => isReady(app.compilation.status));

  const summary: Omit<CompileSummary, "state" | "label"> = {
    total: apps.length,
    ready: ready.length,
    failed: failed.length,
    compiling: compiling.length,
    warnings: warned.length,
  };

  if (apps.length === 0) {
    return workspaceLoaded ? { ...summary, state: "empty", label: "" } : { ...summary, state: "loading", label: "Loading…" };
  }

  if (failed.length > 0) {
    if (apps.length === 1) {
      return { ...summary, state: "failed", label: `${failed[0].configuration.name} failed` };
    }
    if (failed.length === apps.length) {
      return { ...summary, state: "failed", label: `All ${pluralCount(apps.length, "app")} failed` };
    }
    return { ...summary, state: "failed", label: `${failed.length} of ${apps.length} apps failed` };
  }

  if (compiling.length > 0) {
    const label = compiling.length === 1 ? `Compiling ${compiling[0].configuration.name}…` : `Compiling ${pluralCount(compiling.length, "app")}…`;
    return { ...summary, state: "compiling", label };
  }

  if (warned.length > 0) {
    return { ...summary, state: "warning", label: `${pluralCount(apps.length, "app")} · ${pluralCount(warned.length, "warning")}` };
  }

  return { ...summary, state: "ready", label: pluralCount(apps.length, "app") };
}

// The receipt shown for a few seconds after a batch settles green.
export function settledLabel(apps: App[], milliseconds: number): string {
  const seconds = Math.max(milliseconds, 100) / 1000;
  const duration = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  return `${pluralCount(apps.length, "app")} ready · ${duration}`;
}
