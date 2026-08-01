import * as monaco from "monaco-editor";

// Monaco resolves themes globally, so the response palette has to live in the
// app-wide theme. The rules below only name JSON tokens, which the TypeScript
// editors never emit, so those keep the stock vs / vs-dark colors.
//
// Keys, strings, numbers and literals each get their own hue, and none of them
// is red: red is reserved for actual error states (failed calls, the response
// status line, the error banner).
const jsonRules = {
  dark: [
    { token: "string.key.json", foreground: "9CDCFE" },
    { token: "string.value.json", foreground: "9DDFA6" },
    { token: "number.json", foreground: "D9B48F" },
    { token: "keyword.json", foreground: "C4A2E8" },
    { token: "delimiter.bracket.json", foreground: "8B8B8B" },
    { token: "delimiter.array.json", foreground: "8B8B8B" },
    { token: "delimiter.colon.json", foreground: "8B8B8B" },
    { token: "delimiter.comma.json", foreground: "8B8B8B" },
  ],
  light: [
    { token: "string.key.json", foreground: "0B5FA5" },
    { token: "string.value.json", foreground: "1F7A3D" },
    { token: "number.json", foreground: "8A5000" },
    { token: "keyword.json", foreground: "6F42C1" },
    { token: "delimiter.bracket.json", foreground: "6E7781" },
    { token: "delimiter.array.json", foreground: "6E7781" },
    { token: "delimiter.colon.json", foreground: "6E7781" },
    { token: "delimiter.comma.json", foreground: "6E7781" },
  ],
};

monaco.editor.defineTheme("kaja-dark", { base: "vs-dark", inherit: true, rules: jsonRules.dark, colors: {} });
monaco.editor.defineTheme("kaja-light", { base: "vs", inherit: true, rules: jsonRules.light, colors: {} });

export function monacoTheme(colorMode: "day" | "night"): string {
  return colorMode === "night" ? "kaja-dark" : "kaja-light";
}
