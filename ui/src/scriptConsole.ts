import { LogLevel } from "./server/api";

/**
 * The `console` a script sees.
 *
 * A script's log lines belong to the run that printed them; every other
 * `console.log` in Kaja belongs to whoever is debugging Kaja. Telling the two
 * apart is not a judgement about a message — it is a matter of scope: the script
 * body is wrapped in a function that takes `console` as a parameter, so inside it
 * the name resolves to this wrapper and everywhere else to the real thing. App
 * code a script calls into keeps the real console; a closure the script defines
 * keeps this one, however late it fires.
 *
 * There is deliberately no `kaja.log`. The `kaja` object holds the verbs that are
 * Kaja's own — drawing, asking, approving — and logging is not one of them:
 * a second spelling of `console.log` would add a decision without adding a
 * capability, and the value of a log line is that it costs nothing to write and
 * nothing to delete.
 */

// Which proto level each console method reports at. `log` and `info` are one
// level, which is what they effectively are in a browser too.
export const CONSOLE_LEVELS: { readonly [method: string]: LogLevel } = {
  debug: LogLevel.LEVEL_DEBUG,
  log: LogLevel.LEVEL_INFO,
  info: LogLevel.LEVEL_INFO,
  warn: LogLevel.LEVEL_WARN,
  error: LogLevel.LEVEL_ERROR,
};

export type LogSink = (level: LogLevel, message: string) => void;

/**
 * Everything the real console can do, with the five level methods reported to
 * `sink` on the way through.
 *
 * The wrapper is built *from* the console rather than declared as a list of five
 * methods: the list was what made `console.table(rows)` throw
 * "console.table is not a function" inside an agent's snippet, which is a
 * particularly bad way to find out that logging is being intercepted. Anything
 * that isn't a level — `table`, `time`, `group`, `dir`, `trace`, and whatever a
 * future runtime adds — passes straight through to devtools, which is where
 * instrumentation belongs and where it stays.
 */
export function scriptConsole(sink: LogSink, real: Console = console): Console {
  const wrapper = cloneConsole(real) as unknown as { [key: string]: unknown };

  for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
    const forward = wrapper[method] as ((...parts: unknown[]) => void) | undefined;
    wrapper[method] = (...parts: unknown[]) => {
      // Devtools first: a sink that throws must not swallow the line it was
      // given, and a script's own logging must never be able to stop the script.
      forward?.(...parts);
      try {
        sink(level, formatLine(parts));
      } catch {
        // A console that can fail is worse than one that is quiet.
      }
    };
  }

  return wrapper as unknown as Console;
}

/**
 * A standalone object with every method the given console has, each forwarding to
 * it. Used to build the script's console, and to keep hold of the real one before
 * it is patched.
 *
 * Console methods sit on the object in some engines and on its prototype in
 * others, and are not reliably enumerable in either — so the chain is walked by
 * property name rather than spread or `for..in`. Each is bound to its owner: a
 * method called with a different receiver is a detail no engine promises to
 * tolerate.
 */
export function cloneConsole(real: Console): Console {
  const clone: { [key: string]: unknown } = {};
  for (let object: object | null = real; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const key of Object.getOwnPropertyNames(object)) {
      if (key in clone) continue;
      const value = (real as unknown as { [key: string]: unknown })[key];
      clone[key] = typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    }
  }
  return clone as unknown as Console;
}

// One line from what was passed to one call. Strings are themselves, so the
// commonest case reads as it was written; everything else is JSON, which is what
// a script is printing when it prints anything else.
export function formatLine(parts: unknown[]): string {
  return parts.map(formatArg).join(" ");
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message ? `${value.name}: ${value.message}` : value.name;
  try {
    // A bigint has no JSON form and is an ordinary field value in a proto, so it
    // is printed rather than thrown over.
    return JSON.stringify(value, (_key, held) => (typeof held === "bigint" ? held.toString() : held)) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * How the level names reach `kaja.log`. The file is read by whoever is holding a
 * broken build, so the level column stays a level and the origin is a marker in
 * the message — `[ui] [ERROR] [script] …` says both things without teaching the
 * file a second vocabulary.
 */
export function logFileLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.LEVEL_ERROR:
      return "ERROR";
    case LogLevel.LEVEL_WARN:
      return "WARN";
    case LogLevel.LEVEL_DEBUG:
      return "DEBUG";
    default:
      return "INFO";
  }
}
