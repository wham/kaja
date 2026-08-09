import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";

// The task runner transpiles without type checking, so only a syntax error can
// stop a script from running. TypeScript numbers those below 2000; anything
// above is a semantic complaint the run doesn't care about. Run's disabled state
// and the finder trigger's error count both read this, which is what keeps the
// command row from disagreeing with itself.
export function useSyntaxErrors(model: monaco.editor.ITextModel | undefined): { count: number; first?: string } {
  const [errors, setErrors] = useState<{ count: number; first?: string }>({ count: 0 });

  useEffect(() => {
    if (!model) {
      setErrors({ count: 0 });
      return;
    }
    const update = () => {
      const markers = monaco.editor.getModelMarkers({ resource: model.uri }).filter((m) => m.severity === monaco.MarkerSeverity.Error && isSyntaxCode(m.code));
      setErrors({ count: markers.length, first: markers[0]?.message });
    };
    update();
    const disposable = monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((uri) => uri.toString() === model.uri.toString())) update();
    });
    return () => disposable.dispose();
  }, [model]);

  return errors;
}

function isSyntaxCode(code: monaco.editor.IMarker["code"]): boolean {
  const value = typeof code === "object" && code !== null ? code.value : code;
  const number = Number(value);
  return Number.isFinite(number) && number < 2000;
}
