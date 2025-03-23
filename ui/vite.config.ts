import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vite.setup.ts"],
    // https://github.com/vitest-dev/vitest/discussions/1806
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: __dirname + "/node_modules/monaco-editor/esm/vs/editor/editor.api",
      },
    ],
  },
});
