import { Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, showTooltip, Tooltip, WidgetType } from "@codemirror/view";
import { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { cn } from "./cn";
import { Button } from "./components/button";
import { FormControl } from "./components/form-control";
import { dateToTimestamp, findTimestamps, formatDateForDisplay, formatTimestampCode, TimestampMatch, timestampToDate } from "./timestampPicker";

interface TimestampPickerProps {
  initialSeconds: string;
  initialNanos: number;
  fieldName: string;
  onApply: (newCode: string) => void;
}

function getTimezoneAbbr(): string {
  return new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "Local";
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeForInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function TimestampPicker({ initialSeconds, initialNanos, fieldName, onApply }: TimestampPickerProps) {
  const initialDate = timestampToDate(initialSeconds, initialNanos);

  const [dateValue, setDateValue] = useState(formatDateForInput(initialDate));
  const [timeValue, setTimeValue] = useState(formatTimeForInput(initialDate));

  const handleApply = () => {
    if (!dateValue) return;
    const finalTime = timeValue || "00:00";
    const newDate = new Date(`${dateValue}T${finalTime}`);
    if (!isNaN(newDate.getTime())) {
      const { seconds, nanos } = dateToTimestamp(newDate);
      const newCode = formatTimestampCode(fieldName, seconds, nanos);
      onApply(newCode);
    }
  };

  const handleSetNow = () => {
    const { seconds, nanos } = dateToTimestamp(new Date());
    const newCode = formatTimestampCode(fieldName, seconds, nanos);
    onApply(newCode);
  };

  const handleClear = () => {
    const newCode = formatTimestampCode(fieldName, "0", 0);
    onApply(newCode);
  };

  const inputClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="min-w-[280px] rounded-md border border-border bg-popover p-4 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
      <FormControl>
        <FormControl.Label>Date and time ({getTimezoneAbbr()})</FormControl.Label>
        <div className="flex gap-2">
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className={cn(inputClass, "flex-1")} />
          <input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} className={cn(inputClass, "w-[110px]")} />
        </div>
      </FormControl>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleApply}>
          Apply
        </Button>
        <Button size="sm" variant="outline" onClick={handleSetNow}>
          Now
        </Button>
        <Button size="sm" variant="destructive" onClick={handleClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

class TimestampChip extends WidgetType {
  constructor(private match: TimestampMatch) {
    super();
  }

  // A chip kept across an edit keeps the match its click opens, so it is kept only
  // where every offset in that match still holds.
  eq(other: TimestampChip): boolean {
    const a = this.match;
    const b = other.match;
    return a.from === b.from && a.to === b.to && a.anchor === b.anchor && a.fieldName === b.fieldName && a.seconds === b.seconds && a.nanos === b.nanos;
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ml-2 rounded-sm bg-muted px-1.5 font-sans text-[11px] text-muted-foreground hover:text-foreground";
    chip.textContent = `📅 ${formatDateForDisplay(timestampToDate(this.match.seconds, this.match.nanos))}`;
    chip.onmousedown = (event) => event.preventDefault();
    chip.onclick = () => view.dispatch({ effects: openPicker.of(this.match) });
    return chip;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function chips(text: string): DecorationSet {
  return Decoration.set(findTimestamps(text).map((match) => Decoration.widget({ widget: new TimestampChip(match), side: 1 }).range(match.to)));
}

const openPicker = StateEffect.define<TimestampMatch | null>();

const picker = StateField.define<TimestampMatch | null>({
  create: () => null,
  update(open, transaction) {
    for (const effect of transaction.effects) if (effect.is(openPicker)) return effect.value;
    // A picker is about the text it was opened on.
    return transaction.docChanged ? null : open;
  },
  provide: (field) =>
    showTooltip.from(field, (match): Tooltip | null =>
      match
        ? {
            pos: match.anchor,
            above: false,
            create(view) {
              const dom = document.createElement("div");
              const root: Root = createRoot(dom);
              root.render(
                <TimestampPicker
                  initialSeconds={match.seconds}
                  initialNanos={match.nanos}
                  fieldName={match.fieldName}
                  onApply={(code) => view.dispatch({ changes: { from: match.from, to: match.to, insert: code }, effects: openPicker.of(null) })}
                />,
              );
              return { dom, destroy: () => setTimeout(() => root.unmount()) };
            },
          }
        : null,
    ),
});

/**
 * A `Timestamp` written as seconds and nanos is a date nobody can read, so each one is
 * followed by the date it is and a click that opens a picker over it.
 */
export function timestampPicker(): Extension {
  return [
    picker,
    StateField.define<DecorationSet>({
      create: (state) => chips(state.doc.toString()),
      update: (decorations, transaction) => (transaction.docChanged ? chips(transaction.state.doc.toString()) : decorations),
      provide: (field) => EditorView.decorations.from(field),
    }),
    keymap.of([{ key: "Escape", run: (view) => (view.state.field(picker) ? (view.dispatch({ effects: openPicker.of(null) }), true) : false) }]),
  ];
}
