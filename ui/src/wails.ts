/**
 * The desktop, behind the one question of whether there is one.
 *
 * Wails v3's runtime is a module with side effects — it takes over the context
 * menu, watches for drag regions, and warns to the console when it can't find a
 * host to talk to — and the generated bindings import it. A browser must load
 * none of that, so both are reached through `import()`: esbuild keeps them in
 * the bundle and evaluates them the first time something asks, which on the web
 * is never.
 */

const bindings = () => import("./bindings/github.com/wham/kaja/desktop/app");
const runtime = () => import("@wailsio/runtime");

/**
 * Whether a Wails webview is hosting this page. The test is the host's own
 * message channel — the same one the runtime looks for — because that is
 * installed by the native side before any script runs and is what makes every
 * verb below answerable.
 */
export function isWailsEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window as unknown as {
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    wails?: { invoke?: unknown };
  };
  return Boolean(host.chrome?.webview?.postMessage || host.webkit?.messageHandlers?.external?.postMessage || host.wails?.invoke);
}

/** The bound Go methods. Only ever awaited where `isWailsEnvironment()` holds. */
export function desktop(): Promise<typeof import("./bindings/github.com/wham/kaja/desktop/app")> {
  return bindings();
}

/**
 * Subscribes to an event the Go side emits. The unsubscribe is handed back at
 * once, as the v2 runtime's was, so a React effect can return it — the loading
 * of the runtime is what happens behind it.
 */
export function onWailsEvent<T = unknown>(name: string, handler: (data: T) => void): () => void {
  let off: (() => void) | undefined;
  let cancelled = false;
  runtime()
    .then(({ Events }) => {
      if (cancelled) return;
      off = Events.On(name, (event) => handler(event.data as T));
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    off?.();
  };
}

/** Emits an event the Go side is listening for. */
export function emitWailsEvent(name: string, data?: unknown): void {
  runtime()
    .then(({ Events }) => Events.Emit(name, data ?? null))
    .catch(() => {});
}

/** Opens a URL in the system browser rather than in the webview. */
export function openInBrowser(url: string): void {
  runtime()
    .then(({ Browser }) => Browser.OpenURL(url))
    .catch(() => {});
}

/** Puts text on the system clipboard, saying whether it landed. */
export function setClipboardText(text: string): Promise<boolean> {
  return runtime()
    .then(({ Clipboard }) => Clipboard.SetText(text))
    .then(() => true)
    .catch(() => false);
}

/** Sets the window's title. */
export function setWindowTitle(title: string): void {
  runtime()
    .then(({ Window }) => Window.SetTitle(title))
    .catch(() => {});
}
