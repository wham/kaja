import * as monaco from "monaco-editor";
import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "./cn";
import { CODE_SHEET_REST_HEIGHT, CodeSheet, CodeSheetPage } from "./CodeSheet";
import { consoles } from "./consoles";
import { SheetPosition } from "./phone";

/** What the console is handed on a phone: where its log goes, and the two gestures the sheet answers. */
export interface PhoneConsole {
  logHost: HTMLElement | null;
  onShowCalls: () => void;
  onShowCanvas: () => void;
}

export interface PhoneScript {
  fileId: string;
  model: monaco.editor.ITextModel;
  readOnly: boolean;
}

interface PhoneFrameProps {
  // The finder, trigger and sheet both: the header is its trigger.
  finder: React.ReactNode;
  // Run for a script, the view's own verb for anything else.
  action?: React.ReactNode;
  // Set while the view on screen is a script or a draft.
  script?: PhoneScript;
  // The mounted editors, whichever view is current; they live in the sheet.
  editor: React.ReactNode;
  console: (phone: PhoneConsole) => React.ReactNode;
  // Every other view's body.
  children: React.ReactNode;
}

/**
 * The window under 640px: a header that is the finder and Run, and under it the run
 * with the script as a sheet along the bottom. There is no sidebar, no splitter and no
 * status bar — what the status bar said is said on the finder's own rows.
 */
export function PhoneFrame({ finder, action, script, editor, console: renderConsole, children }: PhoneFrameProps) {
  const [position, setPosition] = useState<SheetPosition>("rest");
  const [page, setPage] = useState<CodeSheetPage>("code");
  const [editing, setEditing] = useState(false);
  const [logHost, setLogHost] = useState<HTMLElement | null>(null);
  const fileId = script?.fileId;

  // A file with no run to show opens on its code, which is what you came for; one
  // with runs opens on the run.
  useLayoutEffect(() => {
    if (fileId === undefined) return;
    setPosition(consoles.file(fileId).groups.length === 0 ? "up" : "rest");
    setPage("code");
    setEditing(false);
  }, [fileId]);

  // A run starting is a request to watch it, so the sheet gets out of its way. Only a
  // live one: the runs a file kept from last time arrive settled.
  useSyncExternalStore(
    useCallback((notify: () => void) => (fileId === undefined ? () => {} : consoles.subscribeFile(fileId, notify)), [fileId]),
    useCallback(() => consoles.fileVersion(fileId), [fileId]),
  );
  const newest = consoles.file(fileId).groups.at(-1);
  const newestRunId = newest?.run.id;
  const newestRunning = newest?.running === true;
  useLayoutEffect(() => {
    if (newestRunId !== undefined && newestRunning) setPosition("rest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestRunId]);

  const phone = useMemo<PhoneConsole>(
    () => ({
      logHost,
      onShowCalls: () => {
        setPage("log");
        setPosition("up");
      },
      onShowCanvas: () => setPosition("rest"),
    }),
    [logHost],
  );

  const up = script !== undefined && position === "up";

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground" style={{ overscrollBehavior: "contain" }}>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-chrome px-3">
        {finder}
        {action}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {script && (
          <div
            data-testid="phone-run"
            className={cn("flex min-h-0 flex-1 flex-col transition-opacity duration-200", up && "opacity-40")}
            style={{ paddingBottom: CODE_SHEET_REST_HEIGHT }}
          >
            {renderConsole(phone)}
          </div>
        )}
        <div className={cn("flex min-h-0 flex-1 flex-col", script && "hidden")}>{children}</div>
        {/* The run behind a raised sheet is dimmed, and a tap on it is the way back. */}
        {up && <button type="button" aria-label="Show the run" className="absolute inset-0 z-10" onClick={() => setPosition("rest")} />}
        <CodeSheet
          model={script?.model}
          fileId={fileId}
          readOnly={script?.readOnly ?? true}
          position={position}
          onPositionChange={setPosition}
          page={page}
          onPageChange={setPage}
          editing={editing}
          onEditingChange={setEditing}
          editor={editor}
          onLogHost={setLogHost}
        />
      </div>
    </div>
  );
}
