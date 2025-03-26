import { Box } from "@primer/react";
import { editor } from "monaco-editor";
import { useRef, useState } from "react";
import { Console, ConsoleItem } from "./Console";
import { ControlBar } from "./ControlBar";
import { Editor } from "./Editor";
import { Gutter } from "./Gutter";
import { Kaja, MethodCall } from "./kaja";
import { Project } from "./project";
import { runTask } from "./taskRunner";

interface TaskProps {
  model: editor.ITextModel;
  projects: Project[];
  onInteraction: () => void;
  onGoToDefinition: (model: editor.ITextModel) => void;
}

export function Task({ model, projects, onInteraction, onGoToDefinition }: TaskProps) {
  const [editorHeight, setEditorHeight] = useState(400);
  const [consoleItems, setConsoleItems] = useState<ConsoleItem[]>([]);
  const editorRef = useRef<editor.IStandaloneCodeEditor>();
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
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          height: editorHeight,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <ControlBar onRun={onRun} />
        <Editor model={model} onMount={onEditorMount} onGoToDefinition={onGoToDefinition} />
      </Box>
      <Gutter orientation="horizontal" onResize={onEditorResize} />
      <Console items={consoleItems} />
    </Box>
  );
}
