import { getClipboardText, isWailsEnvironment, setClipboardText } from "./wails";

/**
 * Puts text on the clipboard and reports whether it landed, so a copied state
 * never claims a copy that didn't happen.
 *
 * `navigator.clipboard` exists only in secure contexts, which neither the
 * desktop webview's custom-scheme page nor a kaja served over plain http is —
 * so the desktop goes through the host's own clipboard, and a browser without
 * the API falls back to copying a selection.
 */
export async function copyText(text: string): Promise<boolean> {
  if (isWailsEnvironment()) return setClipboardText(text);
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The API can refuse where the fallback still works — an unfocused
      // document, a denied permission.
    }
  }
  return copySelection(text);
}

/**
 * What is on the clipboard, empty where nothing can read it — the same rule the
 * other way round, with no fallback: a selection can be written but not read.
 */
export async function clipboardText(): Promise<string> {
  if (isWailsEnvironment()) return getClipboardText();
  try {
    return (await navigator.clipboard?.readText()) ?? "";
  } catch {
    return "";
  }
}

function copySelection(text: string): boolean {
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let landed = false;
  try {
    landed = document.execCommand("copy");
  } catch {
    landed = false;
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return landed;
}
