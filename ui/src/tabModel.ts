import * as monaco from "monaco-editor";
import { createProjectRef, Method, Project, Service } from "./project";
import { generateMethodEditorCode } from "./projectLoader";
import { ConfigurationProject, RpcProtocol } from "./server/api";

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
  originalCode: string;
  viewState?: monaco.editor.ICodeEditorViewState;
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
  // Check if there's an existing tab with the same original code - if so, reuse it
  const generatedCode = generateMethodEditorCode(originProject, originService, originMethod);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.type === "task" && tab.originalCode === generatedCode) {
      return { tabs, activeIndex: i };
    }
  }

  const newTab = newTaskTab(originMethod, originService, originProject, generatedCode);
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

function newTaskTab(originMethod: Method, originService: Service, originProject: Project, editorCode: string): TaskTab {
  const id = generateId("task");

  return {
    type: "task",
    id,
    originMethod,
    originService,
    originProject,
    hasInteraction: false,
    model: monaco.editor.createModel(editorCode, "typescript", monaco.Uri.parse("ts:/" + id + ".ts")),
    originalCode: editorCode,
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

// --- Tab state persistence ---

interface PersistedTaskTab {
  type: "task";
  projectName: string;
  serviceName: string;
  methodName: string;
  code: string;
  originalCode: string;
  hasInteraction: boolean;
  viewState?: object;
}

interface PersistedCompilerTab {
  type: "compiler";
}

type PersistedTab = PersistedTaskTab | PersistedCompilerTab;

export interface PersistedTabState {
  version: 1;
  activeIndex: number;
  tabs: PersistedTab[];
}

export function serializeTabs(
  tabs: TabModel[],
  activeIndex: number,
  getViewState: (tabId: string) => monaco.editor.ICodeEditorViewState | null | undefined,
): PersistedTabState {
  const serializedTabs: PersistedTab[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.type === "compiler") {
      indexMap.push(serializedTabs.length);
      serializedTabs.push({ type: "compiler" });
    } else if (tab.type === "task") {
      indexMap.push(serializedTabs.length);
      serializedTabs.push({
        type: "task",
        projectName: tab.originProject.configuration.name,
        serviceName: tab.originService.name,
        methodName: tab.originMethod.name,
        code: tab.model.getValue(),
        originalCode: tab.originalCode,
        hasInteraction: tab.hasInteraction,
        viewState: (getViewState(tab.id) ?? tab.viewState) as object | undefined,
      });
    }
  }

  const adjustedIndex = activeIndex < indexMap.length ? indexMap[activeIndex] ?? 0 : 0;

  return { version: 1, activeIndex: adjustedIndex, tabs: serializedTabs };
}

export function restoreTabs(state: PersistedTabState | undefined): { tabs: TabModel[]; activeIndex: number } | null {
  if (!state) return null;
  const tabs: TabModel[] = [];

  for (const persisted of state.tabs) {
    if (persisted.type === "compiler") {
      tabs.push({ type: "compiler" });
      continue;
    }

    const id = generateId("task");
    const model = monaco.editor.createModel(persisted.code, "typescript", monaco.Uri.parse("ts:/" + id + ".ts"));
    const method: Method = { name: persisted.methodName };
    const service: Service = {
      name: persisted.serviceName,
      packageName: "",
      sourcePath: "",
      clientStubModuleId: "",
      methods: [method],
    };
    const configuration: ConfigurationProject = {
      name: persisted.projectName,
      protocol: RpcProtocol.UNSPECIFIED,
      url: "",
      protoDir: "",
      useReflection: false,
      headers: {},
    };

    tabs.push({
      type: "task",
      id,
      originMethod: method,
      originService: service,
      originProject: {
        configuration,
        projectRef: createProjectRef(configuration),
        compilation: { status: "pending", logs: [] },
        services: [service],
        clients: {},
        sources: [],
        stub: { serviceInfos: {} },
      },
      hasInteraction: persisted.hasInteraction,
      model,
      originalCode: persisted.originalCode,
      viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
    });
  }

  if (tabs.length === 0) return null;

  const activeIndex = Math.min(state.activeIndex, tabs.length - 1);
  return { tabs, activeIndex };
}

export function linkTabsToProjects(tabs: TabModel[], projects: Project[]): void {
  for (const tab of tabs) {
    if (tab.type !== "task") continue;

    const project = projects.find((p) => p.configuration.name === tab.originProject.configuration.name);
    if (!project) continue;
    const service = project.services.find((s) => s.name === tab.originService.name);
    if (!service) continue;
    const method = service.methods.find((m) => m.name === tab.originMethod.name);
    if (!method) continue;

    tab.originProject = project;
    tab.originService = service;
    tab.originMethod = method;
  }
}
