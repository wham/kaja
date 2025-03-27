import { Box } from "@primer/react";
import { editor } from "monaco-editor";
import { Editor, onGoToDefinition } from "./Editor";

interface DefinitionProps {
  model: editor.ITextModel;
  onGoToDefinition: onGoToDefinition;
  startLineNumber?: number;
  startColumn?: number;
}

export function Definition({ model, onGoToDefinition, startLineNumber, startColumn }: DefinitionProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Editor model={model} onGoToDefinition={onGoToDefinition} readOnly={true} startLineNumber={startLineNumber} startColumn={startColumn} />
    </Box>
  );
}
