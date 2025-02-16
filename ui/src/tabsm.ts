import { Method } from "./project";

interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  originMethod: Method;
  hasInteraction: boolean;
}

export type TabModel = CompilerTab | TaskTab;

let counter = 0;

function id(type: string): string {
  return `${type}-${counter++}`;
}

export function newTaskTab(originMethod: Method): TaskTab {
  return {
    type: "task",
    id: id("task"),
    originMethod,
    hasInteraction: false,
  };
}

export function markInteraction(tabs: TabModel[], index: number): TabModel[] {
  if (!tabs[index] || tabs[index].type !== "task" || tabs[index].hasInteraction) {
    return tabs;
  }

  tabs[index].hasInteraction = true;
  return [...tabs];
}
