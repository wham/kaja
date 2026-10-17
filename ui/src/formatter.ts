import * as prettier from "prettier";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEsTree from "prettier/plugins/estree";

export async function formatJson(code: string): Promise<string> {
  return format(code, "json", [prettierPluginBabel, prettierPluginEsTree]);
}

export async function formatTypeScript(code: string): Promise<string> {
  return format(code, "babel-ts", [prettierPluginBabel, prettierPluginEsTree]);
}

// Formats and remaps an offset in the original code to the corresponding offset
// in the formatted code, so positions survive the reformatting.
export async function formatTypeScriptWithCursor(code: string, cursorOffset: number): Promise<{ code: string; cursorOffset: number }> {
  try {
    const result = await prettier.formatWithCursor(code, {
      parser: "babel-ts",
      plugins: [prettierPluginBabel, prettierPluginEsTree],
      cursorOffset,
    });
    return { code: result.formatted, cursorOffset: result.cursorOffset };
  } catch {
    console.warn("Failed to format typescript", code);
    return { code, cursorOffset };
  }
}

function format(code: string, parser: string, plugins: prettier.Plugin[]): Promise<string> {
  return prettier
    .format(code, { parser, plugins })
    .then((formattedCode) => {
      return formattedCode;
    })
    .catch(() => {
      console.warn("Failed to format " + parser, code);
      return code;
    });
}
