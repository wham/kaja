import { json } from "@codemirror/lang-json";
import { foldAll, foldGutter, unfoldAll } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { search, searchKeymap } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { copyText } from "./clipboard";
import { codeHighlighting, codeTheme, foldMarker } from "./codeTheme";
import { drawnText, printJson } from "./payloadText";

interface JsonViewerProps {
  value: any;
  rawText?: string;
  // A phone has no width to scroll sideways through, so lines wrap instead.
  wrap?: boolean;
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
});

/**
 * A payload, read rather than edited. The text is the editor's own DOM, so a long press
 * on a phone selects it and offers Copy the way any text does.
 */
export const JsonViewer = forwardRef<JsonViewerHandle, JsonViewerProps>(function JsonViewer({ value, rawText, wrap = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const jsonTextRef = useRef("");

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
    if (view.state.doc.toString() === drawn) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: drawn } });
    view.scrollDOM.scrollTop = 0;
  }, [value, rawText]);

  return <div ref={containerRef} className="h-full bg-background text-xs" />;
});
