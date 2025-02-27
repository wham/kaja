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
  project: Project;
  onInteraction: () => void;
}

export function Task({ model, project, onInteraction }: TaskProps) {
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

  async function callMethod() {
    if (!editorRef.current || !project) {
      return;
    }

    runTask(editorRef.current.getValue());

    let lines = editorRef.current.getValue().split("\n"); // split the code into lines

    let isInImport = false;
    // remove import statements
    while (lines.length > 0 && (lines[0].startsWith("import ") || isInImport)) {
      isInImport = !lines[0].endsWith(";");
      lines.shift();
    }

    for (const client of Object.values(project.clients)) {
      client.kaja = kajaRef.current;
    }

    const func = new Function(...Object.keys(project.clients), "kaja", lines.join("\n"));
    func(...Object.values(project.clients).map((client) => client.methods), kajaRef.current);
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
        <ControlBar onRun={callMethod} />
        <Editor model={model} onMount={onEditorMount} />
      </Box>
      <Gutter orientation="horizontal" onResize={onEditorResize} />
      <Console items={consoleItems} />
    </Box>
  );
}
