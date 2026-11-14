import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { Choice, FieldControl, fieldType, RequestRow, TextControl } from "./requestEdits";

interface FieldSheetProps {
  row: RequestRow | undefined;
  control: FieldControl | undefined;
  onWrite: (text: string) => void;
  onClose: () => void;
  onRemove?: () => void;
  onEditAsText?: () => void;
}

/**
 * The control for one value in a request, as a sheet over a phone's window: a closed set
 * is a list a tap answers, anything else a field of the value's own kind with what was
 * sent before beside it. What it hands back is source text, so the sheet never decides
 * how a value is spelled.
 */
export function FieldSheet({ row, control, onWrite, onClose, onRemove, onEditAsText }: FieldSheetProps) {
  const open = row !== undefined && control !== undefined;
  // Held through the closing animation, which still draws what was picked.
  const shown = useRef({ row, control });
  if (open) shown.current = { row, control };
  const { row: drawn, control: drawnControl } = shown.current;
  const keyboard = useKeyboardInset(open);

  const write = (text: string) => {
    onWrite(text);
    onClose();
  };

  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          aria-label={drawn ? `Edit ${drawn.key}` : "Edit"}
          initialFocus={false}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[14px] border-t border-border bg-popover text-popover-foreground shadow-lg outline-none transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full"
          style={keyboard ? { bottom: keyboard.inset, maxHeight: keyboard.height * 0.8 } : { maxHeight: "80vh", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {drawn && drawnControl && (
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
                <div className="min-w-0 flex-1">
                  <BaseDialog.Title className="truncate text-[15px] font-semibold text-foreground">{drawn.key}</BaseDialog.Title>
                  <div className="truncate text-xs text-muted-foreground">{[drawn.method, fieldType(drawn.field)].filter(Boolean).join(" · ")}</div>
                </div>
                <BaseDialog.Close
                  aria-label="Close"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none active:bg-accent"
                >
                  <X size={18} />
                </BaseDialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <Control key={`${drawn.method}:${drawn.value.start}`} control={drawnControl} onWrite={write} />
              </div>
              {(onEditAsText || onRemove) && (
                <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
                  {onEditAsText && (
                    <button type="button" className="h-10 flex-1 rounded-lg border border-border text-sm font-medium active:bg-accent" onClick={onEditAsText}>
                      Edit as text
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      className="h-10 flex-1 rounded-lg border border-border text-sm font-medium text-destructive active:bg-accent"
                      onClick={() => {
                        onRemove();
                        onClose();
                      }}
                    >
                      Remove field
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

// iOS draws its keyboard over the layout viewport rather than shrinking it, so a sheet
// at `bottom: 0` sits under the keyboard its own field raised. The visual viewport is
// what is left above it.
function useKeyboardInset(open: boolean): { inset: number; height: number } | undefined {
  const [keyboard, setKeyboard] = useState<{ inset: number; height: number }>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const measure = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboard(inset > 0 ? { inset, height: viewport.height } : undefined);
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [open]);
  return keyboard;
}

function Control({ control, onWrite }: { control: FieldControl; onWrite: (text: string) => void }) {
  switch (control.kind) {
    case "choice":
      return (
        <>
          <Choices choices={control.choices} onWrite={onWrite} />
          {control.other && (
            <div className="border-t border-border pt-2">
              <div className="px-4 text-xs text-muted-foreground">Something else</div>
              <TextField control={control.other} onWrite={onWrite} focus={false} />
            </div>
          )}
        </>
      );
    case "instant":
      return <InstantField date={control.date} onWrite={(date) => onWrite(control.write(date))} />;
    default:
      return <TextField control={control} onWrite={onWrite} focus />;
  }
}

function Choices({ choices, onWrite }: { choices: Choice[]; onWrite: (text: string) => void }) {
  return (
    <div role="listbox">
      {choices.map((choice) => (
        <button
          key={choice.text}
          type="button"
          role="option"
          aria-selected={choice.selected}
          className="flex min-h-12 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] last:border-b-0 active:bg-accent/60"
          onClick={() => onWrite(choice.text)}
        >
          <span className={cn("min-w-0 flex-1 truncate", choice.selected && "font-semibold")}>{choice.label}</span>
          {choice.note !== undefined && <span className="shrink-0 font-mono text-xs text-muted-foreground">{choice.note}</span>}
          <Check size={18} className={cn("shrink-0", !choice.selected && "invisible")} />
        </button>
      ))}
    </div>
  );
}

function TextField({ control, onWrite, focus }: { control: TextControl; onWrite: (text: string) => void; focus: boolean }) {
  const [value, setValue] = useState(control.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const written = control.write(value);

  // Focused in the sheet's own gesture, which is the one iOS raises the keyboard for.
  useEffect(() => {
    if (focus) inputRef.current?.focus({ preventScroll: true });
  }, [focus]);

  const done = () => {
    if (written !== undefined) onWrite(written);
  };

  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              done();
            }
          }}
          inputMode={control.kind === "number" ? "decimal" : undefined}
          enterKeyHint="done"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={written === undefined}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] text-foreground outline-none focus:border-ring aria-invalid:border-destructive"
        />
        <button
          type="button"
          disabled={written === undefined}
          className="h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={done}
        >
          Done
        </button>
      </div>
      {control.suggestions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {control.suggestions.slice(0, 12).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="max-w-full truncate rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground active:bg-accent"
              onClick={() => {
                const text = control.write(suggestion);
                if (text !== undefined) onWrite(text);
              }}
            >
              {suggestion === "" ? <span className="italic">empty</span> : suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A datetime-local field is the phone's own wheel, in the phone's own zone; what is
// written is the instant it names.
function InstantField({ date, onWrite }: { date: Date; onWrite: (date: Date) => void }) {
  const [value, setValue] = useState(localInputValue(date));
  const picked = value === "" ? undefined : new Date(value);
  const valid = picked !== undefined && !Number.isNaN(picked.getTime());
  const shortcuts: { label: string; date: Date }[] = [
    { label: "Now", date: new Date() },
    { label: "1 day ago", date: new Date(Date.now() - 86_400_000) },
    { label: "7 days ago", date: new Date(Date.now() - 7 * 86_400_000) },
    { label: "30 days ago", date: new Date(Date.now() - 30 * 86_400_000) },
  ];
  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] text-foreground outline-none focus:border-ring"
        />
        <button
          type="button"
          disabled={!valid}
          className="h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={() => picked && valid && onWrite(picked)}
        >
          Done
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className="rounded-full border border-border px-3 py-1 text-[13px] text-muted-foreground active:bg-accent"
            onClick={() => onWrite(new Date(Math.floor(shortcut.date.getTime() / 1000) * 1000))}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      {picked && valid && <div className="mt-2 text-xs text-muted-foreground">Written in UTC as {picked.toISOString().replace(/\.000Z$/, "Z")}</div>}
    </div>
  );
}

function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
