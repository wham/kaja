import * as monaco from "monaco-editor";
import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "./cn";
import { CODE_SHEET_REST_HEIGHT, CodeSheet } from "./CodeSheet";
import { consoles } from "./consoles";
import { SheetPosition } from "./phone";

/** What the console is handed on a phone: the one gesture it asks the sheet for. */
export interface PhoneConsole {
  // Full screen on a phone is the sheet getting out of the way.
  onShowRun: () => void;
}

export interface PhoneScript {
  fileId: string;
  name: string;
  model: monaco.editor.ITextModel;
  readOnly: boolean;
}

interface PhoneFrameProps {
  // The finder, trigger and sheet both: the header is its trigger.
  finder: React.ReactNode;
  // Run for a script, the view's own verb for anything else.
  action?: React.ReactNode;
  // The nearest script in the view stack, whose editor stays mounted in the sheet.
  script?: PhoneScript;
  // Set while that script is the view on screen: the run is the body and the sheet is
  // there to raise. Anywhere else there is no sheet.
  onScript: boolean;
  // The mounted editors, whichever view is current; they live in the sheet.
  editor: React.ReactNode;
  console: (phone: PhoneConsole) => React.ReactNode;
  // Every other view's body.
  children: React.ReactNode;
}

/**
 * The window under 640px: a header that is the finder and Run, the view under it, and
 * on a script, its code as an overlay raised over the run. There is no sidebar,
 * no splitter and no sidebar foot — what the sidebar said is said on the finder's
 * own rows.
 */
export function PhoneFrame({ finder, action, script, onScript, editor, console: renderConsole, children }: PhoneFrameProps) {
  const [position, setPosition] = useState<SheetPosition>("rest");
  const [editing, setEditing] = useState(false);
  const fileId = script?.fileId;

  // A file with no run to show opens on its code, which is what you came for; one
  // with runs opens on the run.
  useLayoutEffect(() => {
    if (fileId === undefined) return;
    setPosition(consoles.file(fileId).groups.length === 0 ? "half" : "rest");
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

  // A keyboard leaves nothing over for what the sheet covers, so editing takes the
  // screen rather than being typed into through a gap.
  const onEditingChange = useCallback((next: boolean) => {
    setEditing(next);
    if (next) setPosition("full");
  }, []);

  // Putting the sheet away ends the edit with it: a keyboard over a 24px grabber has
  // nothing left to type into.
  const onPositionChange = useCallback((next: SheetPosition) => {
    setPosition(next);
    if (next === "rest") setEditing(false);
  }, []);

  const phone = useMemo<PhoneConsole>(() => ({ onShowRun: () => onPositionChange("rest") }), [onPositionChange]);

  const up = onScript && position !== "rest";

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground" style={{ overscrollBehavior: "contain" }}>
      <div className="shrink-0 border-b border-border bg-chrome" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex h-[52px] items-center gap-2 px-3">
          {finder}
          {action}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {onScript && (
          <div
            data-testid="phone-run"
            className={cn("flex min-h-0 flex-1 flex-col transition-opacity duration-200", up && "opacity-40")}
            style={{ paddingBottom: `calc(${CODE_SHEET_REST_HEIGHT}px + env(safe-area-inset-bottom))` }}
          >
            {renderConsole(phone)}
          </div>
        )}
        <div className={cn("flex min-h-0 flex-1 flex-col", onScript && "hidden")} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {children}
        </div>
        {/* What is behind a raised sheet is dimmed, and a tap on it is the way back. */}
        {up && <button type="button" aria-label="Put the code away" className="absolute inset-0 z-10" onClick={() => onPositionChange("rest")} />}
        <CodeSheet
          model={onScript ? script?.model : undefined}
          name={script?.name}
          readOnly={script?.readOnly ?? true}
          position={position}
          onPositionChange={onPositionChange}
          editing={editing}
          onEditingChange={onEditingChange}
          editor={editor}
        />
      </div>
    </div>
  );
}
