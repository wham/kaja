import { Pencil } from "lucide-react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { Button } from "./components/button";

interface CodePaneProps {
  // Absent anywhere but on a script; the pane still holds the editors.
  model?: monaco.editor.ITextModel;
  // A file the server can't write, or an agent's draft: read and run, never Edit.
  readOnly: boolean;
  editing: boolean;
  // Only ever to start: Done is the frame's, in the control row, since a keyboard
  // covers the foot.
  onEditingChange: (editing: boolean) => void;
  // The mounted editors, drawn in place of the printed code while editing.
  editor: React.ReactNode;
}

/**
 * The script on a phone, the first of the views over its run. The code is printed
 * rather than edited until Edit is pressed, because a page that opens a keyboard is a
 * page you cannot read.
 */
export function CodePane({ model, readOnly, editing, onEditingChange, editor }: CodePaneProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {model && !editing && <CodeReading model={model} />}
      {/* Always in the document, editing or not: an editor unmounted is an editor
          disposed, and it is the one the window's view cache is holding. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", !editing && "hidden")}>{editor}</div>
      {model && !readOnly && !editing && (
        <Button
          variant="outline"
          size="sm"
          className="absolute right-4 z-20 h-[36px] gap-1.5 bg-card px-3.5 text-sm shadow-md"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
          data-testid="code-pane-edit"
          onClick={() => onEditingChange(true)}
        >
          <Pencil size={14} className="text-muted-foreground" />
          Edit
        </Button>
      )}
    </div>
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
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 pt-3 pb-20">
      <pre data-testid="code-reading" className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
