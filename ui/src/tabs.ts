interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  label: string;
  code: string;
}

export type TabModel = CompilerTab | TaskTab;
