import * as prettier from "prettier";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEsTree from "prettier/plugins/estree";
import prettierPluginTypescript from "prettier/plugins/typescript";

export async function formatJson(code: string): Promise<string> {
  return format(code, "json", [prettierPluginBabel, prettierPluginEsTree]);
}

export async function formatTypeScript(code: string): Promise<string> {
  return format(code, "typescript", [prettierPluginTypescript, prettierPluginEsTree]);
}

function format(code: string, parser: string, plugins: prettier.Plugin[]): Promise<string> {
  return prettier
    .format(code, { parser, plugins })
    .then((formattedCode) => {
      return formattedCode;
    })
    .catch((error) => {
      console.warn("Failed to format " + parser, error);
      return code;
    });
}
