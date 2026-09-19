import { ChevronLeft, Pencil } from "lucide-react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { MOBILE_HEADER_HEIGHT } from "./mobile";

interface MobileFrameProps {
  /** The finder's trigger, which under this frame is also the only thing saying where you are. */
  finder: React.ReactNode;
  /** Run, or the view's own verb. Always one tap away, which is why it is the header's other half. */
  action?: React.ReactNode;
  pageRef: React.RefObject<HTMLDivElement | null>;
  /** The editor, when the script is being typed into. It takes the frame instead of the page. */
  editing?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The window under 640px: one 52px header and one page that scrolls. The header is
 * what the sidebar header, the command row and the status bar all became — the finder
 * is the navigation, so the sidebar has nothing left to be, and a status bar under a
 * page this narrow is a line of text nobody scrolls to.
 *
 * Script and console are stacked in that one scroll rather than split: a splitter is
 * a pointer's control, and two panes in 390px are each half of nothing.
 */
export function MobileFrame({ finder, action, pageRef, editing, children }: MobileFrameProps) {
  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div
        className="@container flex shrink-0 items-center gap-2 border-b border-border bg-chrome px-3"
        style={{ height: MOBILE_HEADER_HEIGHT, "--wails-draggable": "drag" } as React.CSSProperties}
      >
        <div className="flex min-w-0 flex-1 items-center" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
          {finder}
        </div>
        {action && (
          <div className="flex shrink-0 items-center" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
            {action}
          </div>
        )}
      </div>
      {/* The page stays mounted under the editor rather than being swapped out: a
          view holding work nothing else has — an app form, the variables table — is
          in there, and Edit is not a reason to lose it. Kept visible-but-inert
          rather than display:none, which would drop the scroll you were at. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={pageRef}
          data-testid="mobile-page"
          className={cn("absolute inset-0 overflow-y-auto overscroll-contain", editing !== undefined && "invisible pointer-events-none")}
        >
          {children}
        </div>
        {editing && <div className="absolute inset-0 flex flex-col bg-background">{editing}</div>}
      </div>
    </div>
  );
}

interface MobileScreenProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A screen pushed over the frame. It is what a pane becomes when there is no room to
 * put one beside anything: a payload, a table row's record. Back is the only way out,
 * so there is one place to aim at rather than a close button in a corner.
 */
export function MobileScreen({ title, onClose, children }: MobileScreenProps) {
  return (
    <div data-testid="mobile-screen" className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-chrome pr-3" style={{ height: MOBILE_HEADER_HEIGHT }}>
        <button type="button" className="flex h-11 items-center gap-1 pl-2 pr-3 text-sm text-foreground active:opacity-60" onClick={onClose}>
          <ChevronLeft size={18} />
          Back
        </button>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">{title}</span>
      </div>
      {/* A container so everything inside measures itself against the screen it is
          on: the payload pane's readouts leave in the order they are worth, the
          same way they do in a narrow pane. */}
      <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

interface MobileScriptProps {
  model: monaco.editor.ITextModel;
  /** No Edit where nothing would keep the keystrokes: a file the workspace can't write. */
  canEdit: boolean;
  onEdit: () => void;
}

/**
 * The script at the top of the page: what it says, not a field you are in. It is
 * soft-wrapped and carries no line numbers, because the page is 390px wide and a
 * gutter of numbers is a tenth of it spent on something no finger points at.
 *
 * Edit is what swaps the editor in, over the same model — so what is read here and
 * what is typed there can never be two texts.
 */
export function MobileScript({ model, canEdit, onEdit }: MobileScriptProps) {
  const text = useModelText(model);
  const html = useColorized(text);
  const lines = model.getLineCount();

  return (
    <div className="border-b border-border">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Read-only · {lines} {lines === 1 ? "line" : "lines"}
        </span>
        {canEdit && (
          <button
            type="button"
            data-testid="mobile-edit-script"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-foreground active:bg-accent"
            onClick={onEdit}
          >
            <Pencil size={13} />
            Edit
          </button>
        )}
      </div>
      {html === undefined ? <pre className={scriptTextClass}>{text}</pre> : <pre className={scriptTextClass} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

// The editor's own size rather than the 16px it uses on a coarse pointer: that size
// is about the hidden input iOS zooms the page in for, and this is text to read.
const scriptTextClass = "whitespace-pre-wrap break-words px-3 py-3 font-mono text-[13px] leading-[1.5] text-foreground";

function useModelText(model: monaco.editor.ITextModel): string {
  const [text, setText] = useState(() => model.getValue());

  useEffect(() => {
    setText(model.getValue());
    const subscription = model.onDidChangeContent(() => setText(model.getValue()));
    return () => subscription.dispose();
  }, [model]);

  return text;
}

/**
 * Monaco's own colouring, asked for as markup rather than as an editor: the pane is
 * something to read, and an editor here would be a second scroller inside the one
 * scroll this frame is. Undefined until the first answer, so the text is drawn plain
 * rather than not at all.
 */
function useColorized(text: string): string | undefined {
  const [html, setHtml] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    monaco.editor.colorize(text, "typescript", { tabSize: 2 }).then((colored) => {
      if (live) setHtml(colored);
    });
    return () => {
      live = false;
    };
  }, [text]);

  return html;
}
