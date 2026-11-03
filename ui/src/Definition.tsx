import { Editor, onGoToDefinition } from "./Editor";
import { TextBuffer } from "./textBuffer";

interface DefinitionProps {
  buffer: TextBuffer;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
}

export function Definition({ buffer, onGoToDefinition, startLineNumber, startColumn }: DefinitionProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Editor buffer={buffer} onGoToDefinition={onGoToDefinition} readOnly={true} format startLineNumber={startLineNumber} startColumn={startColumn} />
    </div>
  );
}
