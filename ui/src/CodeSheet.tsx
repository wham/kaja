import { Check, Pencil } from "lucide-react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BottomSheet } from "./BottomSheet";
import { cn } from "./cn";
import { Button } from "./components/button";
import { SegmentedControl } from "./components/segmented-control";
import { consoles } from "./consoles";
import { SheetPosition } from "./phone";

// The chrome at rest: the handle's row and the summary line under it.
export const CODE_SHEET_REST_HEIGHT = 56;
// What stays in view above the sheet when it is up: the top of the run it covers.
export const CODE_SHEET_TOP_INSET = 88;

export type CodeSheetPage = "code" | "log";

interface CodeSheetProps {
  // Absent while the view on screen is not a script; the sheet is then hidden rather
  // than unmounted, so the editors it holds stay where they are.
  model?: monaco.editor.ITextModel;
  fileId?: string;
  // A file the server can't write, or an agent's draft: read and run, never Edit.
  readOnly: boolean;
  position: SheetPosition;
  onPositionChange: (position: SheetPosition) => void;
  page: CodeSheetPage;
  onPageChange: (page: CodeSheetPage) => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  // The mounted editors, drawn in place of the printed code while editing.
  editor: React.ReactNode;
  // Where the console puts the run's log.
  onLogHost: (element: HTMLElement | null) => void;
}

/**
 * The script on a phone: a sheet along the bottom of the run it produced. At rest it
 * is a line saying how much code and how many calls there are; pulled up it is two
 * pages, the code and the log. The code is printed rather than edited until Edit is
 * pressed, because a page that opens a keyboard is a page you cannot read.
 */
export function CodeSheet({
  model,
  fileId,
  readOnly,
  position,
  onPositionChange,
  page,
  onPageChange,
  editing,
  onEditingChange,
  editor,
  onLogHost,
}: CodeSheetProps) {
  const lines = useLineCount(model);
  const calls = useCallCount(fileId);

  const chrome =
    position === "up" ? (
      <div className="flex h-[40px] items-center gap-2 px-4">
        <SegmentedControl className="h-[32px] shrink-0 p-[2px]" aria-label="Sheet page">
          <SegmentedControl.Button selected={page === "code"} className="h-[26px] px-3 py-0 text-xs" onClick={() => onPageChange("code")}>
            Code
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={page === "log"} className="h-[26px] gap-1 px-3 py-0 text-xs" onClick={() => onPageChange("log")}>
            Log
            {calls > 0 && <span className="font-mono opacity-70">{calls.toLocaleString()}</span>}
          </SegmentedControl.Button>
        </SegmentedControl>
        {page === "code" && !readOnly && (
          <Button variant="outline" size="sm" className="ml-auto h-[32px] gap-1.5 px-3 text-sm" onClick={() => onEditingChange(!editing)}>
            {editing ? <Check size={14} className="text-muted-foreground" /> : <Pencil size={14} className="text-muted-foreground" />}
            {editing ? "Done" : "Edit"}
          </Button>
        )}
      </div>
    ) : (
      <div className="flex h-[40px] items-center gap-2 px-4 text-xs text-muted-foreground">
        <span className="font-mono">
          {lines} {lines === 1 ? "line" : "lines"}
        </span>
        <span>·</span>
        <span className="font-mono">
          Log {calls.toLocaleString()} {calls === 1 ? "call" : "calls"}
        </span>
        <span className="ml-auto">Pull up for code</span>
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
      <div className={cn("flex min-h-0 flex-1 flex-col", page !== "code" && "hidden")}>
        {model && !editing && <CodeReading model={model} />}
        {/* Always in the document, editing or not: an editor unmounted is an editor
            disposed, and it is the one the window's view cache is holding. */}
        <div className={cn("flex min-h-0 flex-1 flex-col", !editing && "hidden")}>{editor}</div>
      </div>
      <div ref={onLogHost} className={cn("flex min-h-0 flex-1 flex-col", page !== "log" && "hidden")} />
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

// The calls of the run the console is showing, which is what the Log page holds.
function useCallCount(fileId: string | undefined): number {
  useSyncExternalStore(
    useCallback((notify: () => void) => (fileId === undefined ? () => {} : consoles.subscribeFile(fileId, notify)), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );
  const file = consoles.file(fileId);
  const group = file.groups.find((candidate) => candidate.run.id === file.selection?.runId) ?? file.groups[file.groups.length - 1];
  return group?.calls.length ?? 0;
}
