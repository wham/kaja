// The two surfaces something outside the page paints, which takes a color rather than a
// CSS variable: the document body behind the app, and the native window around the
// webview. They are --background and --chrome in tailwind.css.
const surfaces = {
  night: { background: "#0a0a0a", chrome: "#171717" },
  day: { background: "#ffffff", chrome: "#f5f5f5" },
};

type ColorMode = "day" | "night";

// The window's own background, for the document body behind the app.
export function surfaceColor(colorMode: ColorMode): string {
  return surfaces[colorMode].background;
}

// What the native window shows around the webview: on iOS the status bar and the
// home indicator, which border the header and the foot of the page.
export function chromeColor(colorMode: ColorMode): string {
  return surfaces[colorMode].chrome;
}
