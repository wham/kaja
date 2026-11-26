import { EditorState, Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, gutterLineClass, GutterMarker, showTooltip } from "@codemirror/view";
import { parseRunnable } from "./scriptSyntax";

export interface RunRefusal {
  offset: number;
  message: string;
}

/** Why this code can't run, or undefined where it can. */
export function runRefusal(code: string): RunRefusal | undefined {
  const { error } = parseRunnable(code);
  return error && { offset: Math.min(error.offset, code.length), message: error.message };
}

export const showRefusal = StateEffect.define<RunRefusal>();

const refusal = StateField.define<RunRefusal | undefined>({
  create: () => undefined,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(showRefusal)) return effect.value;
    return transaction.docChanged || transaction.selection ? undefined : value;
  },
  provide: (field) => [
    showTooltip.from(field, (value) =>
      value
        ? {
            pos: value.offset,
            above: false,
            create: () => {
              const dom = document.createElement("div");
              dom.className = "mt-1.5 px-2 py-1 text-xs text-destructive!";
              dom.setAttribute("role", "alert");
              dom.textContent = `Can't run yet: ${value.message}`;
              return { dom };
            },
          }
        : null,
    ),
    EditorView.decorations.compute([field], (state) => {
      const line = refusedLine(state);
      return line === undefined ? Decoration.none : Decoration.set(Decoration.line({ class: "cm-refused-line" }).range(line));
    }),
    gutterLineClass.compute([field], (state) => {
      const line = refusedLine(state);
      return line === undefined ? RangeSet.empty : RangeSet.of(refusedGutter.range(line));
    }),
  ],
});

const refusedGutter = new (class extends GutterMarker {
  elementClass = "cm-refused-line-number";
})();

function refusedLine(state: EditorState): number | undefined {
  const value = state.field(refusal);
  return value && state.doc.lineAt(value.offset).from;
}

export const runRefusals: Extension = refusal;
