import { useEffect, useState } from "react";
import { subscribeBuffers, TextBuffer } from "./textBuffer";
import { DIAGNOSTIC_ERROR, isSyntaxCode } from "./typescriptService";

interface Found {
  category: number;
  code: number;
  message: string;
}

const syntaxErrors = new Map<string, { count: number; first?: string }>();
const listeners = new Set<(path: string) => void>();

subscribeBuffers((buffer, event) => {
  if (event === "dispose") syntaxErrors.delete(buffer.path);
});

// What the editor's linter last heard from TypeScript about a buffer, kept for the parts
// of the window that are not the editor.
export function reportDiagnostics(path: string, diagnostics: Found[]): void {
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === DIAGNOSTIC_ERROR && isSyntaxCode(diagnostic.code));
  const previous = syntaxErrors.get(path);
  if (previous?.count === errors.length && previous.first === errors[0]?.message) return;
  syntaxErrors.set(path, { count: errors.length, first: errors[0]?.message });
  for (const listener of listeners) listener(path);
}

// The task runner erases types without checking them, so only a syntax error can stop a
// script from running. Run's disabled state and the finder trigger's error count both
// read this, which is what keeps the command row from disagreeing with itself.
export function useSyntaxErrors(buffer: TextBuffer | undefined): { count: number; first?: string } {
  const [errors, setErrors] = useState<{ count: number; first?: string }>({ count: 0 });

  useEffect(() => {
    if (!buffer) {
      setErrors({ count: 0 });
      return;
    }
    const update = () => setErrors(syntaxErrors.get(buffer.path) ?? { count: 0 });
    update();
    const listener = (path: string) => {
      if (path === buffer.path) update();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [buffer]);

  return errors;
}
