import { cloneConsole } from "./scriptConsole";
import { desktop, isWailsEnvironment } from "./wails";

function formatArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    const head = arg.message ? `${arg.name}: ${arg.message}` : arg.name;
    const stack = arg.stack ?? "";
    // V8 prefixes the stack with "name: message"; WebKit (macOS WKWebView) emits
    // only the call frames, so prepend the header ourselves to keep the message.
    if (stack === "" || stack.startsWith(arg.name)) {
      return stack || head;
    }
    return `${head}\n${stack}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function send(level: string, args: unknown[]): void {
  const message = args.map(formatArg).join(" ");
  // Logging must never throw or recurse back into the patched console.
  write(level, message);
}

function write(level: string, message: string): void {
  desktop()
    .then((app) => app.LogFromUI(level, message))
    .catch(() => {});
}

/**
 * The console as it was before `installUiLog` patched it.
 *
 * A script's console forwards here rather than to the live one: the patched
 * `error`/`warn` write to kaja.log themselves, and a script's lines are written
 * there by `logScriptLine` with their origin attached — so forwarding to the
 * patch would put every script error in the file twice, once anonymously.
 */
export const deviceConsole: Console = cloneConsole(console);

/**
 * A line a script printed, in kaja.log. The level column stays a level so the
 * file is still greppable by severity, and `[script]` says where the line came
 * from: `2026-08-10T… [ui] [INFO] [script] 42 shows`.
 *
 * No-op outside the desktop, like everything else here.
 */
export function logScriptLine(level: string, message: string): void {
  if (!isWailsEnvironment()) {
    return;
  }
  write(level, `[script] ${message}`);
}

/**
 * Mirror frontend console errors and uncaught failures into <kajaHome>/logs/kaja.log
 * via the desktop app. The webview console is otherwise only visible in Web
 * Inspector, so this is how TestFlight users can share frontend logs. No-op
 * outside the Wails desktop environment.
 */
export function installUiLog(): void {
  if (!isWailsEnvironment()) {
    return;
  }

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    send("ERROR", args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    send("WARN", args);
  };

  window.addEventListener("error", (event) => {
    if (event.error instanceof Error) {
      send("ERROR", [event.error]);
      return;
    }
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    send("ERROR", [`${event.message}${where}`]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    send("ERROR", [event.reason]);
  });
}
