import * as monaco from "monaco-editor";
import { Method } from "./project";

interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  originMethod: Method;
  hasInteraction: boolean;
  model: monaco.editor.ITextModel;
}

export type TabModel = CompilerTab | TaskTab;

let counter = 0;

function generateId(type: string): string {
  return `${type}-${counter++}`;
}

export function newTaskTab(originMethod: Method): TaskTab {
  const id = generateId("task");

  return {
    type: "task",
    id,
    originMethod,
    hasInteraction: false,
    model: monaco.editor.createModel(originMethod.editorCode, "typescript", monaco.Uri.parse("ts:/" + id + ".ts")),
  };
}

export function markInteraction(tabs: TabModel[], index: number): TabModel[] {
  if (!tabs[index] || tabs[index].type !== "task" || tabs[index].hasInteraction) {
    return tabs;
  }

  tabs[index].hasInteraction = true;
  return [...tabs];
}

export function addTaskTab(tabs: TabModel[], method: Method): TabModel[] {
  const newTab = newTaskTab(method);
  const lastTab = tabs[tabs.length - 1];

  // If the last tab has no interaction, replace it with the new tab.
  // This is to prevent opening many tabs when the user is just clicking through available methods.
  // Open new tab in case the user keep clicking on the same method - perhaps they want to compare different outputs.
  if (lastTab && lastTab.type === "task" && !lastTab.hasInteraction && lastTab.originMethod !== method) {
    return [...tabs.slice(0, -1), newTab];
  }

  return [...tabs, newTab];
}
