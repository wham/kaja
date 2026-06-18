import { LogFromUI } from "./wailsjs/go/main/App";
import { isWailsEnvironment } from "./wails";

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
  LogFromUI(level, message).catch(() => {});
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
