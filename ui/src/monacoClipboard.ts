// Loaded whole first: Monaco instantiates the editor's features as it initializes,
// so every one of them has to be registered before the line at the foot of this
// file runs.
import "monaco-editor";
import { StandaloneServices } from "monaco-editor/editor/standalone/browser/standaloneServices";

import { clipboardText, copyText } from "./clipboard";

/**
 * Monaco's clipboard, replaced by Kaja's.
 *
 * Monaco's own service is `navigator.clipboard` behind a WebKit workaround: on
 * every click and keydown in the editor it opens a `navigator.clipboard.write`
 * to keep a gesture alive for a write that may follow. The desktop webview's
 * page is not a secure context, so each of those is refused, and the refusal is
 * logged — a NotAllowedError per keystroke, filling the footer's error ring with
 * a workaround that cannot work here. Reading the clipboard is refused there for
 * the same reason, which is what left a paste through the command empty.
 *
 * Kaja already knows where the clipboard is (`clipboard.ts`), so Monaco is given
 * that and the workaround is never installed.
 */
class KajaClipboardService {
  private findText = "";
  private byType = new Map<string, string>();

  async writeText(text: string, type?: string): Promise<void> {
    if (type) {
      this.byType.set(type, text);
      return;
    }
    await copyText(text);
  }

  async readText(type?: string): Promise<string> {
    if (type) return this.byType.get(type) ?? "";
    return clipboardText();
  }

  async readFindText(): Promise<string> {
    return this.findText;
  }

  async writeFindText(text: string): Promise<void> {
    this.findText = text;
  }

  async readResources(): Promise<never[]> {
    return [];
  }

  // The host pastes on its own; nothing here has a paste of its own to trigger.
  triggerPaste(): Promise<void> | undefined {
    return undefined;
  }

  clearInternalState(): void {}
}

/**
 * Monaco instantiates a service the first time anything asks for one —
 * `monaco.editor.defineTheme` is enough — and takes an embedder's overrides only
 * before that. So this happens at this module's own load, and this module is
 * main.tsx's first import.
 */
StandaloneServices.initialize({ clipboardService: new KajaClipboardService() });
