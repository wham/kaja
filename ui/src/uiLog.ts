import { recordAppError } from "./appErrors";
import { bindMembers } from "./bindMembers";
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
  if (level === "ERROR") recordAppError(message);
  write(level, message);
}

// kaja.log is the desktop's alone: it is the file a TestFlight user attaches to a bug
// report. The footer's own account of the same errors is not, which is why the ring
// above is filled on both builds and this is guarded.
function write(level: string, message: string): void {
  if (!isWailsEnvironment()) {
    return;
  }
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
export const deviceConsole: Console = bindMembers(console);

/**
 * A line a script printed, in kaja.log. The level column stays a level so the
 * file is still greppable by severity, and `[script]` says where the line came
 * from: `2026-08-10T… [ui] [INFO] [script] 42 shows`.
 *
 * No-op outside the desktop: `write` is the desktop's alone.
 */
export function logScriptLine(level: string, message: string): void {
  write(level, `[script] ${message}`);
}

/**
 * The first of the two notices that report no failure.
 *
 * A ResizeObserver that observes what its own callback resizes is how every measured
 * element here is drawn, and the spec's answer is to deliver the rest of the
 * notifications on the next frame and tell the window it did — as an error event with
 * no error in it. Nothing failed and nothing was lost, so it is neither a footer row
 * nor a line in kaja.log. Chrome and WebKit word it differently, hence the prefix.
 */
function isResizeObserverNotice(message: string): boolean {
  return message.startsWith("ResizeObserver loop");
}

const CANCELED = "Canceled";

/**
 * The second, and it arrives as a rejection.
 *
 * The editor drops work whose answer nobody wants any more — a completion superseded
 * by the next keystroke, a sticky-scroll model by the next scroll — by rejecting with
 * a cancellation, and one that reaches the window is that same abandonment arriving a
 * frame later with nobody left to read it. Nothing failed, so it is neither a footer
 * row nor a line in kaja.log; what it did light was a ring of `Canceled: Canceled`
 * rows over a session in which nothing had gone wrong. The shape is Monaco's own
 * reading of one (`isCancellationError`): the name and the message are both `Canceled`.
 */
function isCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === CANCELED && reason.message === CANCELED;
}

/**
 * Catch what Kaja failed at: `console.error`, `console.warn`, and the two events that
 * carry a failure nobody caught.
 *
 * The errors go to `appErrors`, which the footer draws, on both builds. Everything
 * also goes to <kajaHome>/logs/kaja.log through `write`, which is the desktop's alone
 * — the webview console is otherwise only visible in Web Inspector, so the file is how
 * a TestFlight user shares frontend logs.
 *
 * `deviceConsole` is read at this module's own load, so it is the unpatched console
 * however late this runs. That is what keeps a script's lines out of the footer.
 */
export function installUiLog(): void {
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
      if (!isCancellation(event.error)) send("ERROR", [event.error]);
      return;
    }
    if (isResizeObserverNotice(event.message)) {
      return;
    }
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    send("ERROR", [`${event.message}${where}`]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isCancellation(event.reason)) {
      return;
    }
    send("ERROR", [event.reason]);
  });
}
