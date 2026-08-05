import * as monaco from "monaco-editor";
import { createPendingApp, Method, App, Script, Service } from "./apps";
import { generateMethodEditorCode } from "./appLoader";
import { appType, appTypeLabel, getAppType } from "./appTypes";
import type { LucideIcon } from "lucide-react";
import { ConfigurationApp } from "./server/api";

interface CompilerTab {
  type: "compiler";
}

interface TaskTab {
  type: "task";
  id: string;
  originMethod: Method;
  originService: Service;
  originApp: App;
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

// An app's settings, opened from the sidebar. The tab is the app: its title is
// the app's name, and a new app is simply the unsaved instance of the same
// document.
export interface AppFormTab {
  type: "appForm";
  id: string;
  mode: "create" | "edit";
  editingAppName?: string;
  initialData?: ConfigurationApp;
  // A preview tab, shown in italics: opening another app's settings reuses it
  // instead of stacking tabs. Editing it, or double-clicking its title, makes it
  // permanent, so work in progress is never replaced out from under the user.
  ephemeral: boolean;
  // Which view of the app the tab is showing. It lives here rather than in the
  // form because the tab strip owns the control that switches it.
  editMode: "form" | "json";
}

export interface ScriptTab {
  type: "script";
  id: string;
  // File-backed script in the global scripts directory; content auto-saves to disk.
  script: Script;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState;
}

export interface VariablesTab {
  type: "variables";
  id: string;
  // Which view of the variables the tab is showing. Like the app form's, it
  // lives here because the tab strip owns the control that switches it.
  editMode: "table" | "json";
}

export type TabModel = CompilerTab | TaskTab | DefinitionTab | AppFormTab | ScriptTab | VariablesTab;

let idGenerator = 0;

function generateId(type: string): string {
  return `${type}-${idGenerator++}`;
}

export interface AddTaskTabResult {
  tabs: TabModel[];
  activeIndex: number;
}

export function addTaskTab(tabs: TabModel[], originMethod: Method, originService: Service, originApp: App): AddTaskTabResult {
  // Check if there's an existing tab with the same original code - if so, reuse it
  const generatedCode = generateMethodEditorCode(originApp, originService, originMethod);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.type === "task" && tab.originalCode === generatedCode) {
      return { tabs, activeIndex: i };
    }
  }

  const newTab = newTaskTab(originMethod, originService, originApp, generatedCode);
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

function newTaskTab(originMethod: Method, originService: Service, originApp: App, editorCode: string): TaskTab {
  const id = generateId("task");

  return {
    type: "task",
    id,
    originMethod,
    originService,
    originApp,
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

export function getScriptTabLabel(tab: ScriptTab): string {
  return tab.script.name.replace(/\.ts$/, "");
}

export function addScriptTab(tabs: TabModel[], script: Script, content: string): { tabs: TabModel[]; activeIndex: number } {
  // Reuse an existing tab for the same file.
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.type === "script" && tab.script.path === script.path) {
      // Refresh contents in case the file changed on disk.
      tab.model.setValue(content);
      tab.script = script;
      return { tabs: [...tabs], activeIndex: i };
    }
  }

  const id = generateId("script");
  const model = monaco.editor.createModel(content, "typescript", monaco.Uri.parse("ts:/" + id + ".ts"));
  const newTab: ScriptTab = {
    type: "script",
    id,
    script,
    model,
  };

  // Replace a trailing ephemeral task tab the same way addTaskTab does.
  const last = tabs[tabs.length - 1];
  const replaceLast = last && ((last.type === "task" && !last.hasInteraction) || last.type === "definition");
  if (replaceLast) {
    const newTabs = [...tabs.slice(0, -1), newTab];
    return { tabs: newTabs, activeIndex: newTabs.length - 1 };
  }
  const newTabs = [...tabs, newTab];
  return { tabs: newTabs, activeIndex: newTabs.length - 1 };
}

// openAppFormTab opens an app's settings. The app's own tab wins if it is already
// open; otherwise a preview tab is reused, and only when there is none does a new
// tab appear. A tab the user has started working in is permanent, so it is never
// the one reused.
export function openAppFormTab(tabs: TabModel[], mode: "create" | "edit", initialData?: ConfigurationApp): { tabs: TabModel[]; activeIndex: number } {
  const open = tabs.findIndex((tab) => tab.type === "appForm" && tab.mode === mode && tab.editingAppName === initialData?.name);
  if (open !== -1) {
    return { tabs, activeIndex: open };
  }

  const reusable = tabs.findIndex((tab) => tab.type === "appForm" && tab.ephemeral);
  const tab: AppFormTab = {
    type: "appForm",
    id: reusable === -1 ? generateId("appForm") : (tabs[reusable] as AppFormTab).id,
    mode,
    editingAppName: initialData?.name,
    initialData,
    ephemeral: true,
    editMode: "form",
  };

  if (reusable !== -1) {
    const updated = [...tabs];
    updated[reusable] = tab;
    return { tabs: updated, activeIndex: reusable };
  }
  return { tabs: [...tabs, tab], activeIndex: tabs.length };
}

// updateAppFormTab replaces what an app form tab holds, keeping the tab itself.
function updateAppFormTab(tabs: TabModel[], index: number, changes: Partial<AppFormTab>): TabModel[] {
  const tab = tabs[index];
  if (!tab || tab.type !== "appForm") return tabs;
  const updated = [...tabs];
  updated[index] = { ...tab, ...changes };
  return updated;
}

// keepAppFormTab makes a preview tab permanent, which is what starting to work in
// it - or double-clicking its title - means.
export function keepAppFormTab(tabs: TabModel[], index: number): TabModel[] {
  const tab = tabs[index];
  if (!tab || tab.type !== "appForm" || !tab.ephemeral) return tabs;
  return updateAppFormTab(tabs, index, { ephemeral: false });
}

export function setAppFormEditMode(tabs: TabModel[], index: number, editMode: "form" | "json"): TabModel[] {
  return updateAppFormTab(tabs, index, { editMode });
}

export function getAppFormTabLabel(tab: AppFormTab): string {
  if (tab.mode === "edit" && tab.editingAppName) {
    // The tab is the app, so it is named after it.
    return tab.editingAppName;
  }
  // In create mode the type is picked in the New dialog, so name the tab for it.
  const type = tab.initialData ? appType(tab.initialData) : "";
  return type ? `New ${appTypeLabel(type)} app` : "New app";
}

// The tab wears the icon of the app it edits, the same one the sidebar shows.
export function getAppFormTabIcon(tab: AppFormTab): LucideIcon | undefined {
  return tab.initialData ? getAppType(appType(tab.initialData))?.icon : undefined;
}

export function getAppFormTabIndex(tabs: TabModel[]): number {
  return tabs.findIndex((tab) => tab.type === "appForm");
}

// Like the app form tab, the variables tab is a singleton: reuse an open one
// instead of stacking duplicates. It is intentionally not persisted.
export function addVariablesTab(tabs: TabModel[]): { tabs: TabModel[]; activeIndex: number } {
  const existingIndex = tabs.findIndex((tab) => tab.type === "variables");
  if (existingIndex !== -1) {
    return { tabs, activeIndex: existingIndex };
  }
  const newTab: VariablesTab = { type: "variables", id: generateId("variables"), editMode: "table" };
  const newTabs = [...tabs, newTab];
  return { tabs: newTabs, activeIndex: newTabs.length - 1 };
}

export function setVariablesEditMode(tabs: TabModel[], index: number, editMode: "table" | "json"): TabModel[] {
  const tab = tabs[index];
  if (!tab || tab.type !== "variables") return tabs;
  const updated = [...tabs];
  updated[index] = { ...tab, editMode };
  return updated;
}

export function getVariablesTabIndex(tabs: TabModel[]): number {
  return tabs.findIndex((tab) => tab.type === "variables");
}

// --- Tab state persistence ---

interface PersistedTaskTab {
  type: "task";
  appName: string;
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

interface PersistedScriptTab {
  type: "script";
  scriptPath: string;
  scriptName: string;
  code: string;
  viewState?: object;
}

type PersistedTab = PersistedTaskTab | PersistedCompilerTab | PersistedScriptTab;

export interface PersistedTabState {
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
        appName: tab.originApp.configuration.name,
        serviceName: tab.originService.name,
        methodName: tab.originMethod.name,
        code: tab.model.getValue(),
        originalCode: tab.originalCode,
        hasInteraction: tab.hasInteraction,
        viewState: (getViewState(tab.id) ?? tab.viewState) as object | undefined,
      });
    } else if (tab.type === "script") {
      indexMap.push(serializedTabs.length);
      serializedTabs.push({
        type: "script",
        scriptPath: tab.script.path,
        scriptName: tab.script.name,
        code: tab.model.getValue(),
        viewState: (getViewState(tab.id) ?? tab.viewState) as object | undefined,
      });
    }
  }

  const adjustedIndex = activeIndex < indexMap.length ? (indexMap[activeIndex] ?? 0) : 0;

  return { activeIndex: adjustedIndex, tabs: serializedTabs };
}

export function restoreTabs(state: PersistedTabState | undefined): { tabs: TabModel[]; activeIndex: number } | null {
  if (!state) return null;
  const tabs: TabModel[] = [];

  for (const persisted of state.tabs) {
    if (persisted.type === "compiler") {
      tabs.push({ type: "compiler" });
      continue;
    }

    if (persisted.type === "script") {
      const sid = generateId("script");
      const model = monaco.editor.createModel(persisted.code, "typescript", monaco.Uri.parse("ts:/" + sid + ".ts"));
      tabs.push({
        type: "script",
        id: sid,
        script: { path: persisted.scriptPath, name: persisted.scriptName },
        model,
        viewState: persisted.viewState as monaco.editor.ICodeEditorViewState | undefined,
      });
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
    const configuration = ConfigurationApp.create({ name: persisted.appName });

    tabs.push({
      type: "task",
      id,
      originMethod: method,
      originService: service,
      originApp: {
        ...createPendingApp(configuration),
        services: [service],
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

// Re-bind restored task tabs to the compiled apps by name. A task tab whose
// app/service/method no longer exists (e.g. the app was deleted while the tab
// was closed) can no longer resolve its import, so it is dropped instead of
// lingering as a stale stub. Runs only once compilation has succeeded, so a
// missing app means removed, not still-compiling. Returns the surviving tabs
// and the ids of the dropped tabs so the caller can clean up editor state.
export function linkTabsToApps(tabs: TabModel[], apps: App[]): { tabs: TabModel[]; removedTabIds: string[] } {
  const kept: TabModel[] = [];
  const removedTabIds: string[] = [];

  for (const tab of tabs) {
    if (tab.type === "task") {
      const app = apps.find((p) => p.configuration.name === tab.originApp.configuration.name);
      const service = app?.services.find((s) => s.name === tab.originService.name);
      const method = service?.methods.find((m) => m.name === tab.originMethod.name);
      if (!app || !service || !method) {
        tab.model.dispose();
        removedTabIds.push(tab.id);
        continue;
      }

      tab.originApp = app;
      tab.originService = service;
      tab.originMethod = method;
    }
    kept.push(tab);
  }

  return { tabs: kept, removedTabIds };
}
