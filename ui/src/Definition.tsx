import { editor } from "monaco-editor";
import { Editor, onGoToDefinition } from "./Editor";

interface DefinitionProps {
  model: editor.ITextModel;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
}

export function Definition({ model, onGoToDefinition, startLineNumber, startColumn }: DefinitionProps) {
  return <Editor model={model} onGoToDefinition={onGoToDefinition} readOnly={true} startLineNumber={startLineNumber} startColumn={startColumn} />;
}
