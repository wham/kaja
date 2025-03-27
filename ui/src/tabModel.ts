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

interface DefinitionTab {
  type: "definition";
  id: string;
  model: monaco.editor.ITextModel;
  startLineNumber: number;
  startColumn: number;
}

export type TabModel = CompilerTab | TaskTab | DefinitionTab;

let idGenerator = 0;

function generateId(type: string): string {
  return `${type}-${idGenerator++}`;
}

export function addTaskTab(tabs: TabModel[], originMethod: Method): TabModel[] {
  const newTab = newTaskTab(originMethod);
  const lastTab = tabs[tabs.length - 1];
  // If the last task tab has no interaction, replace it with the new tab.
  // This is to prevent opening many tabs when the user is just clicking through available methods.
  // Open new tab in case the user keep clicking on the same method - perhaps they want to compare different outputs.
  // Always replace definition tabs.
  const replaceLastTab =
    lastTab && ((lastTab.type === "task" && !lastTab.hasInteraction && lastTab.originMethod !== originMethod) || lastTab.type === "definition");

  if (replaceLastTab) {
    return [...tabs.slice(0, -1), newTab];
  }

  return [...tabs, newTab];
}

function newTaskTab(originMethod: Method): TaskTab {
  const id = generateId("task");

  return {
    type: "task",
    id,
    originMethod,
    hasInteraction: false,
    model: monaco.editor.createModel(originMethod.editorCode, "typescript", monaco.Uri.parse("ts:/" + id + ".ts")),
  };
}

export function addDefinitionTab(tabs: TabModel[], model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): TabModel[] {
  const newTab = newDefinitionTab(model, startLineNumber, startColumn);
  const lastTab = tabs[tabs.length - 1];
  // If the last tab has no interaction, replace it with the new tab.
  // This is to prevent opening many tabs when the user is just clicking through available methods.
  // Always replace definition tabs.
  const replaceLastTab = lastTab && ((lastTab.type === "task" && !lastTab.hasInteraction) || lastTab.type === "definition");

  if (replaceLastTab) {
    return [...tabs.slice(0, -1), newTab];
  }

  return [...tabs, newTab];
}

function newDefinitionTab(model: monaco.editor.ITextModel, startLineNumber: number, startColumn: number): DefinitionTab {
  return {
    type: "definition",
    id: generateId("definition"),
    model,
    startLineNumber,
    startColumn,
  };
}

export function markInteraction(tabs: TabModel[], index: number): TabModel[] {
  if (!tabs[index] || tabs[index].type !== "task" || tabs[index].hasInteraction) {
    return tabs;
  }

  tabs[index].hasInteraction = true;
  return [...tabs];
}

export function getTabLabel(path: string): string {
  return path.split("/").pop() || path;
}
