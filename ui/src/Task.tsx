import { editor } from "monaco-editor";
import { useRef } from "react";
import { ControlBar } from "./ControlBar";
import { Editor, onGoToDefinition } from "./Editor";
import { Kaja } from "./kaja";
import { Project } from "./project";
import { runTask } from "./taskRunner";

interface TaskProps {
  model: editor.ITextModel;
  projects: Project[];
  kaja: Kaja;
  onInteraction: () => void;
  onGoToDefinition: onGoToDefinition;
}

export function Task({ model, projects, kaja, onInteraction, onGoToDefinition }: TaskProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor>(null);

  function onEditorMount(editor: editor.IStandaloneCodeEditor) {
    editorRef.current = editor;
  }

  async function onRun() {
    if (!editorRef.current) {
      return;
    }

    runTask(editorRef.current.getValue(), kaja, projects);
    onInteraction();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ControlBar onRun={onRun} />
      <Editor model={model} onMount={onEditorMount} onGoToDefinition={onGoToDefinition} />
    </div>
  );
}
