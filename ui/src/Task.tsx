import { editor } from "monaco-editor";
import { useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { ControlBar } from "./ControlBar";
import { Editor, onGoToDefinition } from "./Editor";
import { Gutter } from "./Gutter";
import { Kaja, MethodCall } from "./kaja";
import { LayoutColumn, LayoutFixed } from "./Layout";
import { Project } from "./project";
import { runTask } from "./taskRunner";

interface TaskProps {
  model: editor.ITextModel;
  projects: Project[];
  onInteraction: () => void;
  onGoToDefinition: onGoToDefinition;
}

export function Task({ model, projects, onInteraction, onGoToDefinition }: TaskProps) {
  const [editorHeight, setEditorHeight] = useState(400);
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const editorRef = useRef<editor.IStandaloneCodeEditor>(null);
  const kajaRef = useRef(new Kaja(onMethodCallUpdate));

  function onEditorMount(editor: editor.IStandaloneCodeEditor) {
    editorRef.current = editor;
  }

  const onEditorResize = (delta: number) => {
    setEditorHeight((height) => height + delta);
  };

  function onMethodCallUpdate(methodCall: MethodCall) {
    setConsoleItems((consoleItems) => {
      const index = consoleItems.findIndex((item) => item === methodCall);

      if (index > -1) {
        return consoleItems.map((item, i) => {
          if (i === index) {
            return { ...methodCall };
          }
          return item;
        });
      } else {
        return [...consoleItems, methodCall];
      }
    });
  }

  async function onRun() {
    if (!editorRef.current) {
      return;
    }

    runTask(editorRef.current.getValue(), kajaRef.current, projects);
    onInteraction();
  }

  return (
    <LayoutColumn>
      <LayoutFixed style={{ height: editorHeight, position: "relative" }}>
        <ControlBar onRun={onRun} />
        <Editor model={model} onMount={onEditorMount} onGoToDefinition={onGoToDefinition} />
      </LayoutFixed>
      <Gutter orientation="horizontal" onResize={onEditorResize} />
      <Console items={consoleItems} />
    </LayoutColumn>
  );
}
