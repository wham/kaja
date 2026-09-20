import { Check, Pencil } from "lucide-react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { BottomSheet } from "./BottomSheet";
import { cn } from "./cn";
import { Button } from "./components/button";
import { FileName } from "./FileName";
import { SheetPosition } from "./phone";

// The grabber's row, which is the whole of the sheet at rest.
export const CODE_SHEET_REST_HEIGHT = 24;
// What stays in view above the sheet at full height: the run's own chrome, never its
// body — the segmented control has to say which view the sheet is over.
export const CODE_SHEET_TOP_INSET = 68;

interface CodeSheetProps {
  // Absent until some script has been opened; the sheet is then hidden rather than
  // unmounted, so the editors it holds stay where they are.
  model?: monaco.editor.ITextModel;
  // The nearest script in the view stack, which is what this sheet is showing.
  name?: string;
  // A file the server can't write, or an agent's draft: read and run, never Edit.
  readOnly: boolean;
  position: SheetPosition;
  onPositionChange: (position: SheetPosition) => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  // The mounted editors, drawn in place of the printed code while editing.
  editor: React.ReactNode;
}

/**
 * The script on a phone, as an overlay over whatever is on screen rather than a page
 * of the run: a swipe up from the bottom edge brings it over a run, a definition or
 * Variables alike, and it shows the nearest script in the view stack. At rest it is
 * the grabber and nothing else. The code is printed rather than edited until Edit is
 * pressed, because a page that opens a keyboard is a page you cannot read.
 */
export function CodeSheet({ model, name, readOnly, position, onPositionChange, editing, onEditingChange, editor }: CodeSheetProps) {
  const lines = useLineCount(model);

  const chrome = (
    <div className="flex h-[40px] items-center gap-2 border-b border-border px-4">
      <span className="min-w-0 truncate font-mono text-xs">{name && <FileName name={name} />}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">· {editing ? "editing" : `${lines} ${lines === 1 ? "line" : "lines"}`}</span>
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-[30px] shrink-0 gap-1.5 px-3 text-xs"
          data-testid="code-sheet-edit"
          onClick={() => onEditingChange(!editing)}
        >
          {editing ? <Check size={13} className="text-muted-foreground" /> : <Pencil size={13} className="text-muted-foreground" />}
          {editing ? "Done" : "Edit"}
        </Button>
      )}
    </div>
  );

  return (
    <BottomSheet
      position={position}
      onPositionChange={onPositionChange}
      restHeight={CODE_SHEET_REST_HEIGHT}
      topInset={CODE_SHEET_TOP_INSET}
      chrome={chrome}
      hidden={model === undefined}
    >
      {model && !editing && <CodeReading model={model} />}
      {/* Always in the document, editing or not: an editor unmounted is an editor
          disposed, and it is the one the window's view cache is holding. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", !editing && "hidden")}>{editor}</div>
    </BottomSheet>
  );
}

// Coloured by the editor's own tokenizer, so what is printed is what the editor
// draws, in the theme it draws it in.
const PRINT_DELAY_MS = 150;

function CodeReading({ model }: { model: monaco.editor.ITextModel }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let latest = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const print = () => {
      const token = ++latest;
      monaco.editor.colorize(model.getValue(), "typescript", { tabSize: 2 }).then((colorized) => {
        // The tokenizer writes every space as one that never breaks, which is the one
        // thing a line that has to wrap cannot carry.
        if (token === latest) setHtml(colorized.replace(/ /g, " "));
      });
    };
    print();
    const subscription = model.onDidChangeContent(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(print, PRINT_DELAY_MS);
    });
    return () => {
      latest++;
      if (pending) clearTimeout(pending);
      subscription.dispose();
    };
  }, [model]);

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3">
      <pre data-testid="code-reading" className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function useLineCount(model: monaco.editor.ITextModel | undefined): number {
  const [lines, setLines] = useState(() => model?.getLineCount() ?? 0);
  useEffect(() => {
    if (!model) {
      setLines(0);
      return;
    }
    setLines(model.getLineCount());
    const subscription = model.onDidChangeContent(() => setLines(model.getLineCount()));
    return () => subscription.dispose();
  }, [model]);
  return lines;
}
