import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { highlightCode, tags } from "@lezer/highlight";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { StyleModule } from "style-mod";

/**
 * The editor drawn in the window's own tokens. The editor is DOM, so it reads the CSS
 * variables directly and day and night are the `dark` class on <html> like everything
 * else; there is no second table of colors to keep in step.
 */
export const codeTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--background)",
    color: "var(--code-text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
  },
  ".cm-content": { padding: "16px 0", caretColor: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklch, var(--code-type) 30%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--code-punctuation)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--code-text)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer" },
  // A fold that can be made is offered where the pointer is; one that was made stays.
  ".cm-fold-open": { opacity: "0", transition: "opacity 0.15s" },
  ".cm-gutters:hover .cm-fold-open": { opacity: "1" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
    padding: "0 4px",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent)",
    outline: "none",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": { color: "var(--destructive)", backgroundColor: "transparent" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
    overflow: "hidden",
    maxWidth: "var(--tooltip-max-width, none)",
  },
  // Off the line it describes, so the code under it stays readable.
  ".cm-tooltip-hover.cm-tooltip-above": { marginTop: "-6px" },
  ".cm-tooltip-hover.cm-tooltip-below": { marginTop: "6px" },
  ".cm-definition-link": { textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", maxHeight: "16em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--code-type)" },
  ".cm-completionDetail": { color: "var(--muted-foreground)", fontStyle: "normal", marginLeft: "1em" },
  ".cm-completionInfo": { padding: "6px 8px", maxWidth: "28em" },
  ".cm-tooltip.cm-completionInfo": { whiteSpace: "pre-wrap" },
  ".cm-diagnostic": { padding: "4px 8px", borderLeft: "none" },
  ".cm-diagnostic-error": { color: "var(--destructive)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy rgb(217 119 6)",
    textUnderlineOffset: "3px",
  },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--card-foreground)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 28px 6px 8px", fontFamily: "inherit", fontSize: "12px" },
  ".cm-panel.cm-search label": { color: "var(--muted-foreground)", fontSize: "12px" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--primary)", verticalAlign: "middle" },
  ".cm-panel.cm-search [name=close]": { color: "var(--muted-foreground)", right: "8px", top: "6px", fontSize: "16px" },
  ".cm-textfield": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
    borderRadius: "4px",
    padding: "2px 6px",
    fontSize: "12px",
  },
  ".cm-textfield:focus": { outline: "1px solid var(--ring)", outlineOffset: "0" },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "12px",
    textTransform: "none",
  },
  ".cm-button:active": { backgroundImage: "none", backgroundColor: "var(--accent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklch, var(--code-number) 25%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklch, var(--code-number) 45%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--code-type) 15%, transparent)" },
});

export function foldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = open ? "cm-fold-open" : "cm-fold-closed";
  marker.textContent = open ? "⌄" : "›";
  return marker;
}

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword, tags.modifier], color: "var(--code-keyword)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--code-type)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator, tags.comment, tags.lineComment, tags.blockComment], color: "var(--code-punctuation)" },
  { tag: tags.propertyName, color: "var(--code-text)" },
]);

export const codeHighlighting = syntaxHighlighting(highlightStyle);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A script printed in the editor's own colors, for a pane that reads rather than edits.
 * The parser is the editor's, so what is printed is what the editor draws.
 */
export function printCode(code: string, typescript = true): string {
  const language = typescript ? typescriptLanguage : javascriptLanguage;
  // The classes are an editor's until one is mounted, and a printed pane may be the
  // only thing on the page using them.
  if (highlightStyle.module) StyleModule.mount(document, highlightStyle.module);
  let html = "";
  highlightCode(
    code,
    language.parser.parse(code),
    highlightStyle,
    (text, classes) => {
      html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text);
    },
    () => {
      html += "\n";
    },
  );
  return html;
}
