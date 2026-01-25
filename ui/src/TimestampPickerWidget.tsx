import * as monaco from "monaco-editor";
import { useState, useRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { Button, FormControl } from "@primer/react";
import { dateToTimestamp, formatTimestampCode, timestampToDate } from "./timestampPicker";

interface TimestampPickerProps {
  initialSeconds: string;
  initialNanos: number;
  fieldName: string;
  onApply: (newCode: string) => void;
  onClose: () => void;
}

// Get timezone abbreviation (e.g., "PST", "EST", "CET")
function getTimezoneAbbr(): string {
  return new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "Local";
}

// Format date (YYYY-MM-DD) in local timezone
function formatDateForInput(date: Date, isEpoch: boolean): string {
  if (isEpoch) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Format time (HH:MM) in local timezone
function formatTimeForInput(date: Date, isEpoch: boolean): string {
  if (isEpoch) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function TimestampPicker({ initialSeconds, initialNanos, fieldName, onApply, onClose }: TimestampPickerProps) {
  const initialDate = timestampToDate(initialSeconds, initialNanos);
  const isEpoch = initialDate.getTime() === 0;

  const [dateValue, setDateValue] = useState(formatDateForInput(initialDate, isEpoch));
  const [timeValue, setTimeValue] = useState(formatTimeForInput(initialDate, isEpoch));
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  const applyValue = (date: string, time: string) => {
    if (date) {
      const finalTime = time || "00:00";
      const newDate = new Date(`${date}T${finalTime}`);
      if (!isNaN(newDate.getTime())) {
        const { seconds, nanos } = dateToTimestamp(newDate);
        const newCode = formatTimestampCode(fieldName, seconds, nanos);
        onApply(newCode);
      }
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value;
    setDateValue(newDate);
    if (newDate) {
      applyValue(newDate, timeValue);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = e.target.value;
    setTimeValue(newTime);
    if (dateValue && newTime) {
      applyValue(dateValue, newTime);
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
    backgroundColor: "#0d1117",
    border: "1px solid #444c56",
    borderRadius: "6px",
    color: "#e6edf3",
    colorScheme: "dark",
    fontSize: "14px",
  };

  return (
    <div
      style={{
        backgroundColor: "#1c2128",
        border: "1px solid #444c56",
        borderRadius: "6px",
        padding: "16px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        minWidth: "280px",
      }}
    >
      <FormControl>
        <FormControl.Label>Date and time ({getTimezoneAbbr()})</FormControl.Label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            ref={dateRef}
            type="date"
            value={dateValue}
            onChange={handleDateChange}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            ref={timeRef}
            type="time"
            value={timeValue}
            onChange={handleTimeChange}
            style={{ ...inputStyle, width: "110px" }}
          />
        </div>
      </FormControl>
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <Button size="small" onClick={handleSetNow}>
          Now
        </Button>
        <Button size="small" variant="danger" onClick={handleClear}>
          Clear
        </Button>
        <span style={{ flex: 1 }} />
        <Button size="small" variant="invisible" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export class TimestampPickerContentWidget implements monaco.editor.IContentWidget {
  private domNode: HTMLDivElement;
  private root: Root;
  private position: monaco.IPosition;
  private editRange: monaco.Range;
  private disposed = false;

  constructor(
    private editor: monaco.editor.IStandaloneCodeEditor,
    displayRange: monaco.Range,
    editRange: monaco.Range,
    fieldName: string,
    seconds: string,
    nanos: number,
    private onCloseCallback: () => void
  ) {
    this.editRange = editRange;
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
          this.onCloseCallback();
        }}
        onClose={() => {
          if (this.disposed) return;
          this.onCloseCallback();
        }}
      />
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
      preference: [
        monaco.editor.ContentWidgetPositionPreference.BELOW,
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
      ],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.root.unmount();
  }
}
