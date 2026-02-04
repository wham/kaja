import * as monaco from "monaco-editor";
import { Method, Project, Service } from "./project";
import { generateMethodEditorCode } from "./projectLoader";
import { ConfigurationProject } from "./server/api";

interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  originMethod: Method;
  originService: Service;
  originProject: Project;
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

interface ProjectFormTab {
  type: "projectForm";
  id: string;
  mode: "create" | "edit";
  editingProjectName?: string;
  initialData?: ConfigurationProject;
}

export type TabModel = CompilerTab | TaskTab | DefinitionTab | ProjectFormTab;

let idGenerator = 0;

function generateId(type: string): string {
  return `${type}-${idGenerator++}`;
}

export interface AddTaskTabResult {
  tabs: TabModel[];
  activeIndex: number;
}

export function addTaskTab(tabs: TabModel[], originMethod: Method, originService: Service, originProject: Project): AddTaskTabResult {
  // Check if there's an existing tab for this method with the same code - if so, reuse it
  const generatedCode = generateMethodEditorCode(originProject, originService, originMethod);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.type === "task" && tab.originMethod === originMethod && tab.model.getValue() === generatedCode) {
      return { tabs, activeIndex: i };
    }
  }

  const newTab = newTaskTab(originMethod, originService, originProject);
  const lastTab = tabs[tabs.length - 1];
  // If the last task tab has no interaction, replace it with the new tab.
  // This is to prevent opening many tabs when the user is just clicking through available methods.
  // Open new tab in case the user keep clicking on the same method - perhaps they want to compare different outputs.
  // Always replace definition tabs.
  const replaceLastTab =
    lastTab && ((lastTab.type === "task" && !lastTab.hasInteraction && lastTab.originMethod !== originMethod) || lastTab.type === "definition");

  if (replaceLastTab) {
    const newTabs = [...tabs.slice(0, -1), newTab];
    return { tabs: newTabs, activeIndex: newTabs.length - 1 };
  }

  const newTabs = [...tabs, newTab];
  return { tabs: newTabs, activeIndex: newTabs.length - 1 };
}

function newTaskTab(originMethod: Method, originService: Service, originProject: Project): TaskTab {
  const id = generateId("task");
  const editorCode = generateMethodEditorCode(originProject, originService, originMethod);

  return {
    type: "task",
    id,
    originMethod,
    originService,
    originProject,
    hasInteraction: false,
    model: monaco.editor.createModel(editorCode, "typescript", monaco.Uri.parse("ts:/" + id + ".ts")),
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

export function addProjectFormTab(tabs: TabModel[], mode: "create" | "edit", initialData?: ConfigurationProject): TabModel[] {
  // Check if there's already a project form tab open
  const existingIndex = tabs.findIndex((tab) => tab.type === "projectForm");
  if (existingIndex !== -1) {
    // Update existing tab
    const existingTab = tabs[existingIndex] as ProjectFormTab;
    const updatedTabs = [...tabs];
    updatedTabs[existingIndex] = {
      type: "projectForm",
      id: existingTab.id,
      mode,
      editingProjectName: initialData?.name,
      initialData,
    };
    return updatedTabs;
  }

  const newTab: ProjectFormTab = {
    type: "projectForm",
    id: generateId("projectForm"),
    mode,
    editingProjectName: initialData?.name,
    initialData,
  };
  return [...tabs, newTab];
}

export function updateProjectFormTab(tabs: TabModel[], mode: "create" | "edit", initialData?: ConfigurationProject): TabModel[] {
  const existingIndex = tabs.findIndex((tab) => tab.type === "projectForm");
  if (existingIndex === -1) return tabs;

  const existingTab = tabs[existingIndex] as ProjectFormTab;
  const updatedTabs = [...tabs];
  updatedTabs[existingIndex] = {
    type: "projectForm",
    id: existingTab.id,
    mode,
    editingProjectName: initialData?.name,
    initialData,
  };
  return updatedTabs;
}

export function getProjectFormTabLabel(tab: ProjectFormTab): string {
  if (tab.mode === "edit" && tab.editingProjectName) {
    return `Edit ${tab.editingProjectName}`;
  }
  return "New Project";
}

export function getProjectFormTabIndex(tabs: TabModel[]): number {
  return tabs.findIndex((tab) => tab.type === "projectForm");
}
