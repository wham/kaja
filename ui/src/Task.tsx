import { editor } from "monaco-editor";
import { useState } from "react";
import { Editor, onGoToDefinition } from "./Editor";
import { RunButton } from "./RunButton";

interface TaskProps {
  model: editor.ITextModel;
  onGoToDefinition: onGoToDefinition;
  onEditorReady?: (editorInstance: editor.IStandaloneCodeEditor) => void;
  viewState?: editor.ICodeEditorViewState;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  startedAt?: number;
}

export function Task({ model, onGoToDefinition, onEditorReady, viewState, onRun, onStop, running, startedAt }: TaskProps) {
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

  function onEditorMount(instance: editor.IStandaloneCodeEditor) {
    setEditorInstance(instance);
    onEditorReady?.(instance);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Editor model={model} onMount={onEditorMount} onGoToDefinition={onGoToDefinition} viewState={viewState} />
      <RunButton editor={editorInstance} model={model} onRun={onRun} onStop={onStop} running={running} startedAt={startedAt} />
    </div>
  );
}
