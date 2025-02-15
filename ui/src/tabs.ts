interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  label: string;
  model: string;
}

export type TabModel = CompilerTab | TaskTab;

let tabs: TabModel[] = [{ type: "compiler" }, { id: "tab2", label: "Task Tab", type: "task", model: "TaskModel" }];
