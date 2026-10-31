import { App, isReady } from "./apps";
import { Log, LogLevel } from "./server/api";

// Warnings are read off a compile that succeeded; a failed one has its error to show.
export function warningCount(app: App): number {
  return isReady(app.compilation.status) ? app.compilation.warnings : 0;
}

export function countWarnings(logs: Log[]): number {
  return logs.filter((log) => log.level === LogLevel.LEVEL_WARN).length;
}

export function firstWarningLine(logs: Log[]): string | undefined {
  return logs.find((log) => log.level === LogLevel.LEVEL_WARN)?.message;
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

export function countMethods(app: App): number {
  return app.services.reduce((total, service) => total + service.methods.length, 0);
}
