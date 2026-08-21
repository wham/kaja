import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { readInputKeys } from "./scriptInputs";

// Reading the AST costs a parse, and the answer only decides whether a caret is
// drawn — so it lags the keystroke by a beat rather than riding it.
const DEBOUNCE_MS = 400;

/**
 * The parameters the file on screen reads, kept in step as it is edited.
 *
 * It is what puts the caret on the Run button: a script that reads nothing has
 * nothing to be asked for, so it gets a bare Run button. Read from the buffer
 * rather than from disk, because the script as it is now is the one Run runs.
 */
export function useInputKeys(model: monaco.editor.ITextModel | undefined): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!model) {
      setKeys([]);
      return;
    }
    const read = () =>
      setKeys((previous) => {
        const next = readInputKeys(model.getValue());
        return next.length === previous.length && next.every((key, index) => key === previous[index]) ? previous : next;
      });
    read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disposable = model.onDidChangeContent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      disposable.dispose();
    };
  }, [model]);

  return keys;
}
