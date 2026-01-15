import { editor } from "monaco-editor";
import { Editor, onGoToDefinition } from "./Editor";
import { LayoutColumn } from "./Layout";

interface DefinitionProps {
  model: editor.ITextModel;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
}

export function Definition({ model, onGoToDefinition, startLineNumber, startColumn }: DefinitionProps) {
  return (
    <LayoutColumn>
      <Editor model={model} onGoToDefinition={onGoToDefinition} readOnly={true} startLineNumber={startLineNumber} startColumn={startColumn} />
    </LayoutColumn>
  );
}
