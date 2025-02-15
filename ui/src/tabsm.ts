import { Method } from "./project";

interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  originMethod: Method;
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
  };
}
