/**
 * How big the window draws itself, which is the webview's own zoom rather than anything
 * CSS does.
 *
 * A browser already has this, so this is the desktop's: the window has no address bar to
 * carry the browser's own control and nothing else in the app can stand in for it. What
 * the process behind the webview sets is page zoom — the layout is measured in the same
 * CSS pixels it was and simply gets fewer of them, which is what makes every rect, every
 * media query and every popover go on agreeing with each other. CSS `zoom` scales what is
 * drawn without moving what a popover is anchored to, so it is not the way to do this.
 *
 * The ladder is percentages rather than a factor per step, because the footer says the
 * number: 125% is a size someone can ask for again, 172.8% is arithmetic.
 */
export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

export const DEFAULT_ZOOM = 100;

export type ZoomGesture = "in" | "out" | "reset";

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(Math.max(zoom, ZOOM_STEPS[0]), ZOOM_STEPS[ZOOM_STEPS.length - 1]);
}

/** The size the gesture asks for: the next step of the ladder, or the way back to 100%. */
export function zoomAfter(zoom: number, gesture: ZoomGesture): number {
  if (gesture === "reset") return DEFAULT_ZOOM;
  if (gesture === "in") return ZOOM_STEPS.find((step) => step > zoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return ZOOM_STEPS.filter((step) => step < zoom).pop() ?? ZOOM_STEPS[0];
}

/**
 * Which zoom a keystroke asks for, if any. `+` and `-` are read beside `=` and `_`
 * because a keypad has keys of its own for them and a US layout types `+` with shift.
 */
export function zoomGesture(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): ZoomGesture | undefined {
  if (!event.metaKey && !event.ctrlKey) return undefined;
  switch (event.key) {
    case "=":
    case "+":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
  }
  return undefined;
}

/**
 * States the zoom to the one thing the layout has that the zoom does not reach: the room
 * the band leaves the macOS window buttons, which are the system's own and are drawn at
 * the same size whatever the page is zoomed to.
 */
export function declareZoom(zoom: number): void {
  document.documentElement.style.setProperty("--zoom", String(clampZoom(zoom) / 100));
}
