import { json } from "@codemirror/lang-json";
import { foldAll, foldGutter, unfoldAll } from "@codemirror/language";
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { search, searchKeymap } from "@codemirror/search";
import { Decoration, DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { copyText } from "./clipboard";
import { codeHighlighting, codeTheme, foldMarker } from "./codeTheme";
import { EmbeddedMark } from "./embeddedJson";
import { drawnText, printJson } from "./payloadText";

interface JsonViewerProps {
  value: any;
  rawText?: string;
  // A phone has no width to scroll sideways through, so lines wrap instead.
  wrap?: boolean;
  // Where `rawText` holds a string carrying a document, and whether it was opened.
  marks?: EmbeddedMark[];
  onToggleMark?: (key: string) => void;
  // What the text is a printing of, so a string opened in it keeps the scroll and a
  // new payload does not.
  payload?: string;
}

export interface JsonViewerHandle {
  foldAll: () => void;
  unfoldAll: () => void;
  copyToClipboard: () => Promise<boolean>;
}

const wrapping = new Compartment();
const focusable = new Compartment();

const viewerTheme = EditorView.theme({
  ".cm-content": { padding: "12px 0" },
  ".cm-line": { paddingLeft: "4px" },
  ".cm-embedded-line": {
    backgroundColor: "color-mix(in oklch, var(--code-type) 10%, transparent)",
    boxShadow: "inset 2px 0 color-mix(in oklch, var(--code-type) 60%, transparent)",
  },
  ".cm-embedded-chip": {
    font: "600 10px/1 var(--font-sans)",
    letterSpacing: "0.02em",
    color: "var(--code-type)",
    backgroundColor: "color-mix(in oklch, var(--code-type) 16%, transparent)",
    border: "none",
    borderRadius: "4px",
    padding: "3px 5px",
    margin: "0 6px",
    verticalAlign: "1px",
    cursor: "pointer",
  },
  ".cm-embedded-chip:hover": { backgroundColor: "color-mix(in oklch, var(--code-type) 28%, transparent)" },
});

class ChipWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly open: boolean,
    readonly toggle: (key: string) => void,
  ) {
    super();
  }

  eq(other: ChipWidget): boolean {
    return other.key === this.key && other.open === this.open;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-embedded-chip";
    button.textContent = this.open ? "STRING ▾" : "JSON ▸";
    button.title = this.open ? "Show the string as it was sent" : "Read the JSON in this string";
    // Kept off the editor's own selection handling, which would take the press as a
    // click in the text.
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => this.toggle(this.key);
    return button;
  }
}

const NO_MARKS: EmbeddedMark[] = [];

const setMarks = StateEffect.define<DecorationSet>();

const embeddedMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (marks, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setMarks)) return effect.value;
    return marks.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const embeddedLine = Decoration.line({ class: "cm-embedded-line" });

// A closed string's chip follows it; an opened one's comes before the document, on
// the line the string was on, and the document's lines are tinted.
function markDecorations(state: EditorState, marks: EmbeddedMark[], toggle: (key: string) => void): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const length = state.doc.length;
  for (const mark of marks) {
    if (mark.to > length) break;
    const chip = Decoration.widget({ widget: new ChipWidget(mark.key, mark.open, toggle), side: mark.open ? -1 : 1 });
    if (!mark.open) {
      builder.add(mark.to, mark.to, chip);
      continue;
    }
    builder.add(mark.from, mark.from, chip);
    const first = state.doc.lineAt(mark.from).number + 1;
    const last = state.doc.lineAt(mark.to).number;
    for (let line = first; line <= last; line++) {
      const start = state.doc.line(line).from;
      builder.add(start, start, embeddedLine);
    }
  }
  return builder.finish();
}

/**
 * A payload, read rather than edited. The text is the editor's own DOM, so a long press
 * on a phone selects it and offers Copy the way any text does.
 */
export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer(
  { value, rawText, wrap = false, marks = NO_MARKS, onToggleMark, payload },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const jsonTextRef = useRef("");
  const toggleRef = useRef(onToggleMark);
  toggleRef.current = onToggleMark;
  const payloadRef = useRef<string | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    foldAll: () => {
      if (viewRef.current) foldAll(viewRef.current);
    },
    unfoldAll: () => {
      if (viewRef.current) unfoldAll(viewRef.current);
    },
    copyToClipboard: () => copyText(jsonTextRef.current),
  }));

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: jsonTextRef.current,
        extensions: [
          EditorState.readOnly.of(true),
          // Focusable where there is a keyboard, so a payload can be searched; a phone
          // would raise its keyboard over one.
          focusable.of(EditorView.editable.of(!wrap)),
          keymap.of(searchKeymap),
          search({ top: true }),
          json(),
          embeddedMarks,
          foldGutter({ markerDOM: foldMarker }),
          wrapping.of(wrap ? EditorView.lineWrapping : []),
          // Ahead of the shared theme, which it overrides.
          viewerTheme,
          codeTheme,
          codeHighlighting,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [wrapping.reconfigure(wrap ? EditorView.lineWrapping : []), focusable.reconfigure(EditorView.editable.of(!wrap))],
    });
  }, [wrap]);

  // Print the payload into the viewer. Synchronous on purpose: the selection follows a
  // run as it happens, so this runs as often as the console repaints, and an async
  // format could land over a newer payload.
  useEffect(() => {
    const text = rawText ?? printJson(value);
    jsonTextRef.current = text;
    const view = viewRef.current;
    if (!view) return;
    const drawn = drawnText(text);
    const toggle = (key: string) => toggleRef.current?.(key);
    const samePayload = payload !== undefined && payloadRef.current === payload;
    payloadRef.current = payload;
    if (view.state.doc.toString() === drawn) {
      view.dispatch({ effects: setMarks.of(markDecorations(view.state, marks, toggle)) });
      return;
    }
    // Opening or closing a string rewrites the text under the reader, so only a new
    // payload goes back to the top.
    const scrollTop = view.scrollDOM.scrollTop;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: drawn } });
    view.dispatch({ effects: setMarks.of(markDecorations(view.state, marks, toggle)) });
    view.scrollDOM.scrollTop = samePayload ? scrollTop : 0;
  }, [value, rawText, marks, payload]);

  return <div ref={containerRef} className="h-full bg-background text-xs" />;
});
