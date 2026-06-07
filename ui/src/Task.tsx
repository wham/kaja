import { editor } from "monaco-editor";
import { Editor, onGoToDefinition } from "./Editor";

interface TaskProps {
  model: editor.ITextModel;
  onGoToDefinition: onGoToDefinition;
  onEditorReady?: (editorInstance: editor.IStandaloneCodeEditor) => void;
  viewState?: editor.ICodeEditorViewState;
}

export function Task({ model, onGoToDefinition, onEditorReady, viewState }: TaskProps) {
  function onEditorMount(editorInstance: editor.IStandaloneCodeEditor) {
    onEditorReady?.(editorInstance);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Editor model={model} onMount={onEditorMount} onGoToDefinition={onGoToDefinition} viewState={viewState} />
    </div>
  );
}
