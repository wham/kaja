declare module "monaco-editor/editor/standalone/browser/standaloneServices" {
  export const StandaloneServices: {
    initialize(overrides: Record<string, unknown>): void;
  };
}
