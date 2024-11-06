import { Monaco } from "@monaco-editor/react";
import * as prettier from "prettier";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEsTree from "prettier/plugins/estree";
import prettierPluginTypescript from "prettier/plugins/typescript";

export async function formatJson(code: string): Promise<string> {
  return format(code, "json", [prettierPluginBabel, prettierPluginEsTree]);
}

export async function formatAndColorizeJson(value: any, monaco?: Monaco): Promise<string> {
  let output = JSON.stringify(value);
  if (output === undefined || output === null) {
    output = "";
  }
  output = await formatJson(output);
  if (monaco) {
    output = await monaco.editor.colorize(output, "typescript", { tabSize: 2 });
  }
  return output;
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
      console.warn("Failed to format " + parser, code, error);
      return code;
    });
}
