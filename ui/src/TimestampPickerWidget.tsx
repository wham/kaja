import * as monaco from "monaco-editor";
import { createRoot, Root } from "react-dom/client";
import { Button, FormControl, Stack } from "@primer/react";
import { dateToTimestamp, formatTimestampCode, timestampToDate } from "./timestampPicker";

interface TimestampPickerProps {
  initialSeconds: string;
  initialNanos: number;
  fieldName: string;
  onChange: (newCode: string) => void;
  onClose: () => void;
}

// Get timezone abbreviation (e.g., "PST", "EST", "CET")
function getTimezoneAbbr(): string {
  return new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || "Local";
}

function TimestampPicker({ initialSeconds, initialNanos, fieldName, onChange, onClose }: TimestampPickerProps) {
  const initialDate = timestampToDate(initialSeconds, initialNanos);
  const isEpoch = initialDate.getTime() === 0;

  // Format date for datetime-local input in local timezone
  const formatDateForInput = (date: Date) => {
    if (isEpoch) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      const date = new Date(value);
      const { seconds, nanos } = dateToTimestamp(date);
      const newCode = formatTimestampCode(fieldName, seconds, nanos);
      onChange(newCode);
    }
  };

  const handleSetNow = () => {
    const { seconds, nanos } = dateToTimestamp(new Date());
    const newCode = formatTimestampCode(fieldName, seconds, nanos);
    onChange(newCode);
    onClose();
  };

  const handleClear = () => {
    const newCode = formatTimestampCode(fieldName, "0", 0);
    onChange(newCode);
    onClose();
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
        <input
          type="datetime-local"
          defaultValue={formatDateForInput(initialDate)}
          onChange={handleChange}
          style={{
            width: "100%",
            padding: "8px 12px",
            backgroundColor: "#0d1117",
            border: "1px solid #444c56",
            borderRadius: "6px",
            color: "#e6edf3",
            colorScheme: "dark",
            fontSize: "14px",
          }}
        />
      </FormControl>
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: "12px" }}>
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
      </Stack>
    </div>
  );
}

export class TimestampPickerContentWidget implements monaco.editor.IContentWidget {
  private domNode: HTMLDivElement;
  private root: Root;
  private position: monaco.IPosition;
  private editRange: monaco.Range;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    displayRange: monaco.Range,
    editRange: monaco.Range,
    fieldName: string,
    seconds: string,
    nanos: number,
    onClose: () => void
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
        onChange={(newCode) => {
          editor.executeEdits("timestamp-picker", [
            {
              range: this.editRange,
              text: newCode,
            },
          ]);
        }}
        onClose={onClose}
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
    this.root.unmount();
  }
}
