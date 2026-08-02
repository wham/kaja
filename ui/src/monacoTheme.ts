import * as monaco from "monaco-editor";

// Monaco can't read the CSS variables, so the surfaces it paints are repeated
// here as hex. They are the same tokens the rest of the window uses: code sits
// on --background, the deepest plane in the system, and the widgets it floats
// (suggestions, hovers) sit on --popover with a --border hairline.
const surfaces = {
  night: { background: "#0a0a0a", widget: "#171717", border: "#ffffff1a", accent: "#404040", destructive: "#e57373" },
  day: { background: "#ffffff", widget: "#ffffff", border: "#e5e5e5", accent: "#f5f5f5", destructive: "#e7000b" },
};

// Three hues, all of them Kaja's own — emerald for strings, amber for numbers
// and literals, a muted blue for types and imports — at roughly half the chroma
// of VS Dark+, so nothing in a request body outshines the Run button.
// Everything else is carried by the neutral ramp.
//
// None of the three is red: red is reserved for actual error states (failed
// calls, the response status line, the error banner).
const palettes = {
  night: {
    text: "d4d4d4",
    identifier: "d4d4d4",
    type: "7fa6cf",
    keyword: "9a9a9a",
    string: "35b981",
    number: "d19a4a",
    punctuation: "6b6b6b",
  },
  day: {
    text: "3f3f46",
    identifier: "3f3f46",
    type: "35558a",
    keyword: "71717a",
    string: "047857",
    number: "a15c07",
    punctuation: "a1a1aa",
  },
};

type ColorMode = "day" | "night";

// Monaco resolves themes globally, so every language's tokens live in the one
// app-wide theme. The unsuffixed rules cover the TypeScript editors; the .json
// ones cover the response viewer and the app configuration editor, where a key
// can be told apart from a string value.
function rules(mode: ColorMode): monaco.editor.ITokenThemeRule[] {
  const palette = palettes[mode];
  return [
    { token: "", foreground: palette.text },
    { token: "identifier", foreground: palette.identifier },
    { token: "type.identifier", foreground: palette.type },
    { token: "keyword", foreground: palette.keyword },
    { token: "string", foreground: palette.string },
    { token: "number", foreground: palette.number },
    { token: "delimiter", foreground: palette.punctuation },
    { token: "comment", foreground: palette.punctuation },
    { token: "string.key.json", foreground: palette.identifier },
    { token: "string.value.json", foreground: palette.string },
    { token: "number.json", foreground: palette.number },
    { token: "keyword.json", foreground: palette.number },
  ];
}

function colors(mode: ColorMode): monaco.editor.IColors {
  const palette = palettes[mode];
  const surface = surfaces[mode];
  return {
    "editor.background": surface.background,
    "editor.foreground": `#${palette.text}`,
    "editorGutter.background": surface.background,
    "editorLineNumber.foreground": `#${palette.punctuation}`,
    "editorLineNumber.activeForeground": `#${palette.identifier}`,
    "editorWidget.background": surface.widget,
    "editorWidget.border": surface.border,
    "editorSuggestWidget.background": surface.widget,
    "editorSuggestWidget.border": surface.border,
    "editorSuggestWidget.selectedBackground": surface.accent,
    "editorSuggestWidget.selectedForeground": `#${palette.text}`,
    "editorSuggestWidget.highlightForeground": `#${palette.type}`,
    "editorSuggestWidget.focusHighlightForeground": `#${palette.type}`,
    "editorHoverWidget.background": surface.widget,
    "editorHoverWidget.border": surface.border,
    // Bracket pair colorization ships six saturated hues of its own. Brackets
    // are punctuation here, so all six read as punctuation and only a bracket
    // that doesn't match goes red, the one color reserved for errors.
    "editorBracketHighlight.foreground1": `#${palette.punctuation}`,
    "editorBracketHighlight.foreground2": `#${palette.punctuation}`,
    "editorBracketHighlight.foreground3": `#${palette.punctuation}`,
    "editorBracketHighlight.foreground4": `#${palette.punctuation}`,
    "editorBracketHighlight.foreground5": `#${palette.punctuation}`,
    "editorBracketHighlight.foreground6": `#${palette.punctuation}`,
    "editorBracketHighlight.unexpectedBracket.foreground": surface.destructive,
  };
}

monaco.editor.defineTheme("kaja-dark", { base: "vs-dark", inherit: true, rules: rules("night"), colors: colors("night") });
monaco.editor.defineTheme("kaja-light", { base: "vs", inherit: true, rules: rules("day"), colors: colors("day") });

export function monacoTheme(colorMode: ColorMode): string {
  return colorMode === "night" ? "kaja-dark" : "kaja-light";
}

// The window's own background, for the document body behind the app.
export function surfaceColor(colorMode: ColorMode): string {
  return surfaces[colorMode].background;
}
