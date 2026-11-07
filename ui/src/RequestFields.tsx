import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { FieldInfo } from "@protobuf-ts/runtime";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { App } from "./apps";
import { cn } from "./cn";
import { FieldSheet } from "./FieldSheet";
import { Trail } from "./PayloadFields";
import { addField, controlFor, fieldType, readRequestCalls, readRequestLevel, removeField, replaceValue, RequestRow, rowAt, RowValue } from "./requestEdits";
import { TextBuffer } from "./textBuffer";

interface RequestFieldsProps {
  buffer: TextBuffer;
  apps: App[];
  readOnly: boolean;
  // An edit made here, which a draft is saved on.
  onEdit: () => void;
  // Shows the code at an offset: what a value no picker can change is edited in.
  onReveal: (offset: number) => void;
}

/**
 * A phone's reading of the requests a script writes: each call's literal as fields, one
 * level at a time, the way a payload is read. The script's text is what is shown and what
 * is written, so an edit here is an edit of the file, and the editor beside it has it too.
 */
export function RequestFields({ buffer, apps, readOnly, onEdit, onReveal }: RequestFieldsProps) {
  const code = useSyncExternalStore(
    useCallback((notify: () => void) => buffer.onDidChange(notify), [buffer]),
    () => buffer.getValue(),
  );
  const calls = useMemo(() => readRequestCalls(code, apps), [code, apps]);
  const [callIndex, setCallIndex] = useState(0);
  const [path, setPath] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ start: number } | undefined>();
  const [adding, setAdding] = useState(false);

  const index = Math.min(callIndex, Math.max(calls.length - 1, 0));
  const call = calls[index];
  const level = useMemo(() => (call ? readRequestLevel(code, apps, index, path) : undefined), [code, apps, index, path, call]);

  // A level an edit took away is let go of, back to the nearest one still there.
  useEffect(() => {
    if (call?.object && !level && path.length > 0) setPath(path.slice(0, -1));
  }, [call, level, path]);

  const editingRow = editing ? rowAt(code, apps, editing.start) : undefined;
  const control = editingRow && controlFor(editingRow, code);

  const write = (next: string) => {
    buffer.setValue(next);
    onEdit();
  };

  if (calls.length === 0) {
    return <Empty>No calls to an app in this script</Empty>;
  }

  const open = (row: RequestRow) => {
    if (row.value.kind === "object") {
      setPath([...path, row.key]);
    } else if (row.value.kind === "expression" || readOnly || !controlFor(row, code)) {
      onReveal(row.value.start);
    } else {
      setEditing({ start: row.value.start });
    }
  };

  const add = (field: FieldInfo) => {
    if (!level) return;
    const { code: next, offset } = addField(code, level, field);
    write(next);
    setAdding(false);
    // A message is opened rather than asked about: its value is a level of its own.
    if (field.kind === "message" && !field.repeat) setPath([...path, field.localName]);
    else if (field.kind === "scalar" || field.kind === "enum") setEditing({ start: offset });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="truncate text-[15px] font-semibold">{call.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">line {call.line}</span>
        {calls.length > 1 && (
          // A native select is the phone's own wheel, and the list is short.
          <label className="relative ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {index + 1} of {calls.length}
            <ChevronDown size={14} />
            <select
              aria-label="Call"
              value={index}
              onChange={(event) => {
                setCallIndex(Number(event.target.value));
                setPath([]);
              }}
              className="absolute inset-0 opacity-0"
            >
              {calls.map((candidate, position) => (
                <option key={position} value={position}>
                  {candidate.label} · line {candidate.line}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {path.length > 0 && <Trail root={call.label.slice(call.label.indexOf(".") + 1)} path={path} onPathChange={(next) => setPath(next.map(String))} />}
        {!call.object ? (
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-2 border-b border-border px-4 py-2 text-left active:bg-accent/60"
            onClick={() => onReveal(call.argument?.start ?? call.start)}
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">request</div>
              <Expression text={call.argument ? code.slice(call.argument.start, call.argument.end) : "nothing"} />
            </div>
            <ChevronRight size={18} className="shrink-0 text-muted-foreground/60" />
          </button>
        ) : (
          level && (
            <div key={path.join("\u0000")}>
              {level.rows.length === 0 && <div className="px-4 py-3 text-[15px] text-muted-foreground">No fields set</div>}
              {level.rows.map((row) => (
                <FieldRow key={row.key} row={row} onOpen={() => open(row)} readOnly={readOnly} />
              ))}
              {!readOnly && level.unset.length > 0 && (
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left text-[15px] text-muted-foreground active:bg-accent/60"
                  onClick={() => setAdding(true)}
                >
                  <Plus size={16} className="shrink-0" />
                  <span className="shrink-0 text-foreground">Add field</span>
                  <span className="truncate text-[13px]">{level.unset.map((field) => field.localName).join(", ")}</span>
                </button>
              )}
            </div>
          )
        )}
      </div>
      <FieldSheet
        row={editingRow}
        control={control}
        onWrite={(text) => editingRow && write(replaceValue(code, editingRow.value, text))}
        onRemove={editingRow ? () => write(removeField(code, editingRow)) : undefined}
        onEditAsText={
          editingRow
            ? () => {
                setEditing(undefined);
                onReveal(editingRow.value.start);
              }
            : undefined
        }
        onClose={() => setEditing(undefined)}
      />
      <AddFieldSheet open={adding} fields={level?.unset ?? []} onAdd={add} onClose={() => setAdding(false)} />
    </div>
  );
}

function FieldRow({ row, onOpen, readOnly }: { row: RequestRow; onOpen: () => void; readOnly: boolean }) {
  const type = fieldType(row.field);
  const opens = row.value.kind === "object";
  return (
    <button type="button" className="flex min-h-12 w-full items-center gap-2 border-b border-border px-4 py-2 text-left active:bg-accent/60" onClick={onOpen}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{row.key}</span>
          {type && <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4">{type}</span>}
          {!row.field && <span className="shrink-0 text-amber-600 dark:text-amber-400">not a field of this request</span>}
        </div>
        <div className={cn("text-[15px] wrap-anywhere", readOnly && "select-text")}>
          <Value value={row.value} />
        </div>
      </div>
      {opens && <ChevronRight size={18} className="shrink-0 text-muted-foreground/60" />}
    </button>
  );
}

function Value({ value }: { value: RowValue }) {
  switch (value.kind) {
    case "string":
      return value.value === "" ? <span className="text-muted-foreground italic">empty</span> : <span className="whitespace-pre-wrap">{value.value}</span>;
    case "number":
      return <span className="tabular-nums">{value.text}</span>;
    case "boolean":
      return <>{String(value.value)}</>;
    case "enum":
      return <>{value.name ?? value.number}</>;
    case "object":
      return (
        <span className="text-[13px] text-muted-foreground">
          {value.count === 0 ? "No fields set" : `${value.count} ${value.count === 1 ? "field" : "fields"}`}
        </span>
      );
    case "expression":
      return <Expression text={value.text} />;
  }
}

// What the script computes rather than writes, drawn as code: no picker can change it,
// and a tap shows it where it is written.
function Expression({ text }: { text: string }) {
  return (
    <span className="inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 align-middle font-mono text-[12px] text-muted-foreground">{text}</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function AddFieldSheet({ open, fields, onAdd, onClose }: { open: boolean; fields: FieldInfo[]; onAdd: (field: FieldInfo) => void; onClose: () => void }) {
  return (
    <FieldList open={open} onClose={onClose}>
      {fields.map((field) => (
        <button
          key={field.localName}
          type="button"
          className="flex min-h-12 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] last:border-b-0 active:bg-accent/60"
          onClick={() => onAdd(field)}
        >
          <span className="min-w-0 flex-1 truncate">{field.localName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{fieldType(field)}</span>
        </button>
      ))}
    </FieldList>
  );
}

function FieldList({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          aria-label="Add field"
          initialFocus={false}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-[14px] border-t border-border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
            <BaseDialog.Title className="min-w-0 flex-1 text-[15px] font-semibold">Add field</BaseDialog.Title>
            <BaseDialog.Close
              aria-label="Close"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none active:bg-accent"
            >
              <X size={18} />
            </BaseDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
