import { Box } from "@primer/react";
import { editor } from "monaco-editor";
import { Editor } from "./Editor";

interface DefinitionProps {
  model: editor.ITextModel;
  onGoToDefinition: (model: editor.ITextModel) => void;
}

export function Definition({ model, onGoToDefinition }: DefinitionProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Editor model={model} onGoToDefinition={onGoToDefinition} readOnly={true} />
    </Box>
  );
}
