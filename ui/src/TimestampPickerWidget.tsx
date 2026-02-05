import * as monaco from "monaco-editor";
import { useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { Button, FormControl } from "@primer/react";
import { dateToTimestamp, formatTimestampCode, timestampToDate } from "./timestampPicker";

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

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    backgroundColor: "var(--bgColor-default)",
    border: "1px solid var(--borderColor-default)",
    borderRadius: "6px",
    color: "var(--fgColor-default)",
    fontSize: "14px",
  };

  return (
    <div
      style={{
        backgroundColor: "var(--bgColor-muted)",
        border: "1px solid var(--borderColor-default)",
        borderRadius: "6px",
        padding: "16px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        minWidth: "280px",
      }}
    >
      <FormControl>
        <FormControl.Label>Date and time ({getTimezoneAbbr()})</FormControl.Label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} style={{ ...inputStyle, width: "110px" }} />
        </div>
      </FormControl>
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <Button size="small" variant="primary" onClick={handleApply}>
          Apply
        </Button>
        <Button size="small" onClick={handleSetNow}>
          Now
        </Button>
        <Button size="small" variant="danger" onClick={handleClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

export class TimestampPickerContentWidget implements monaco.editor.IContentWidget {
  private domNode: HTMLDivElement;
  private root: Root;
  private position: monaco.IPosition;
  private disposed = false;

  constructor(
    private editor: monaco.editor.IStandaloneCodeEditor,
    displayRange: monaco.Range,
    private editRange: monaco.Range,
    fieldName: string,
    seconds: string,
    nanos: number,
    private onCloseCallback: () => void,
  ) {
    this.position = { lineNumber: displayRange.startLineNumber, column: displayRange.startColumn };

    this.domNode = document.createElement("div");
    this.domNode.style.zIndex = "1000";

    this.root = createRoot(this.domNode);
    this.root.render(
      <TimestampPicker
        initialSeconds={seconds}
        initialNanos={nanos}
        fieldName={fieldName}
        onApply={(newCode) => {
          if (this.disposed) return;
          this.editor.executeEdits("timestamp-picker", [
            {
              range: this.editRange,
              text: newCode,
            },
          ]);
          // Delay close to allow Code Lens to refresh first, reducing blink
          setTimeout(() => this.onCloseCallback(), 100);
        }}
      />,
    );
  }

  getId(): string {
    return "timestamp.picker.widget";
  }

  getDomNode(): HTMLElement {
    return this.domNode;
  }

  getPosition(): monaco.editor.IContentWidgetPosition {
    return {
      position: this.position,
      preference: [monaco.editor.ContentWidgetPositionPreference.BELOW, monaco.editor.ContentWidgetPositionPreference.ABOVE],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.root.unmount();
  }
}
