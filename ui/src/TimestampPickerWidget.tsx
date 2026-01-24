import * as monaco from "monaco-editor";
import { createRoot, Root } from "react-dom/client";
import { Button, FormControl, Stack } from "@primer/react";
import { dateToTimestamp, formatTimestampCode, timestampToDate } from "./timestampPicker";

interface TimestampPickerProps {
  initialSeconds: string;
  initialNanos: number;
  fieldName: string;
  onSelect: (newCode: string) => void;
  onClose: () => void;
}

function TimestampPicker({ initialSeconds, initialNanos, fieldName, onSelect, onClose }: TimestampPickerProps) {
  const initialDate = timestampToDate(initialSeconds, initialNanos);
  const isEpoch = initialDate.getTime() === 0;

  const formatDateForInput = (date: Date) => {
    if (isEpoch) return "";
    return date.toISOString().slice(0, 16);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      const date = new Date(value);
      const { seconds, nanos } = dateToTimestamp(date);
      const newCode = formatTimestampCode(fieldName, seconds, nanos);
      onSelect(newCode);
    }
  };

  const handleSetNow = () => {
    const { seconds, nanos } = dateToTimestamp(new Date());
    const newCode = formatTimestampCode(fieldName, seconds, nanos);
    onSelect(newCode);
  };

  const handleClear = () => {
    const newCode = formatTimestampCode(fieldName, "0", 0);
    onSelect(newCode);
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
        <FormControl.Label>Pick a date and time</FormControl.Label>
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
  private range: monaco.Range;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    range: monaco.Range,
    fieldName: string,
    seconds: string,
    nanos: number,
    onClose: () => void
  ) {
    this.range = range;
    this.position = { lineNumber: range.startLineNumber, column: range.startColumn };

    this.domNode = document.createElement("div");
    this.domNode.style.zIndex = "1000";

    this.root = createRoot(this.domNode);
    this.root.render(
      <TimestampPicker
        initialSeconds={seconds}
        initialNanos={nanos}
        fieldName={fieldName}
        onSelect={(newCode) => {
          editor.executeEdits("timestamp-picker", [
            {
              range: this.range,
              text: newCode,
            },
          ]);
          onClose();
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
